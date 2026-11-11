"""HTTP routes for the Flowbench API."""

from __future__ import annotations

import csv
import io
import itertools
import json

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel, Field

from app import __version__
from app.core import LIMITS, PipelineConfig, PipelineInvalid, run_pipeline
from app.core.planner import plan_pipeline
from app.core.ratelimit import RateLimiter, run_slots
from app.datasets import get_dataset, list_datasets, list_lookups
from app.presets import PRESETS
from app.registry import describe_registry
from app.settings import RATE_LIMIT_SCOPE, RUN_BURST, RUNS_PER_MINUTE
from app.store import (
    MAX_INTERVAL_S, MAX_SCHEDULES, MIN_INTERVAL_S,
    create_schedule, delete_schedule, get_run, list_runs, list_schedules, save_run,
)

router = APIRouter(tags=["Flowbench"])
limiter = RateLimiter(rate_per_min=RUNS_PER_MINUTE, capacity=RUN_BURST)


def _client_key(request: Request) -> str:
    """Rate-limit bucket key. Forwarded IP headers are never trusted: they
    are client-controlled when the Cloud Run URL is called directly."""
    if RATE_LIMIT_SCOPE == "global":
        return "global"
    return request.client.host if request.client else "unknown"


def _execute(request: Request, config: PipelineConfig, trigger: str,
             replayed_from: str | None = None) -> dict:
    """Rate-limit, plan, run under a concurrency slot, persist."""
    if not limiter.allow(_client_key(request)):
        scope = "for this demo" if RATE_LIMIT_SCOPE == "global" else "per client"
        raise HTTPException(429, f"rate limit exceeded ({RUNS_PER_MINUTE} runs/minute {scope}); try again shortly")
    if not run_slots.acquire(blocking=False):
        raise HTTPException(503, "all execution slots are busy; retry in a moment")
    try:
        report = run_pipeline(config, trigger=trigger, replayed_from=replayed_from)
    except PipelineInvalid as exc:
        raise HTTPException(422, {"message": "pipeline has configuration errors", "plan": exc.plan})
    finally:
        run_slots.release()
    run_id = save_run(report)
    return {"run_id": run_id, **report}


@router.get("/health")
def health() -> dict:
    return {"status": "ok"}


@router.get("/meta")
def meta() -> dict:
    return {"version": __version__, "limits": {
        **LIMITS, "runs_per_minute": RUNS_PER_MINUTE, "rate_limit_scope": RATE_LIMIT_SCOPE,
        "max_schedules": MAX_SCHEDULES,
        "schedule_interval_s": [MIN_INTERVAL_S, MAX_INTERVAL_S],
    }}


@router.get("/datasets")
def datasets() -> list[dict]:
    return list_datasets()


@router.get("/datasets/{dataset_id}/sample")
def dataset_sample(dataset_id: str, n: int = 20) -> dict:
    ds = get_dataset(dataset_id)
    if ds is None:
        raise HTTPException(404, f"unknown dataset '{dataset_id}'")
    n = min(max(1, n), 100)
    return {"dataset": ds.describe(), "rows": list(itertools.islice(ds.rows(), n))}


@router.get("/lookups")
def lookups() -> list[dict]:
    return list_lookups()


@router.get("/registry")
def registry() -> dict:
    return describe_registry()


@router.get("/presets")
def presets() -> list[dict]:
    return PRESETS


class RunRequest(BaseModel):
    config: PipelineConfig


class DraftStage(BaseModel):
    kind: str = Field(max_length=16)
    op: str = Field(max_length=64)
    params: dict = Field(default_factory=dict)


class ValidateRequest(BaseModel):
    dataset_id: str = Field(max_length=64)
    stages: list[DraftStage] = Field(default_factory=list, max_length=LIMITS["max_stages"])


@router.post("/validate")
def validate(req: ValidateRequest) -> dict:
    """Plan a draft pipeline without executing it (cheap; not rate limited)."""
    if len(json.dumps(req.model_dump(), default=str)) > 32_768:
        raise HTTPException(413, "pipeline draft too large")
    return plan_pipeline(req.dataset_id, [s.model_dump() for s in req.stages])


@router.post("/runs", status_code=201)
def create_run(req: RunRequest, request: Request) -> dict:
    return _execute(request, req.config, "manual")


@router.get("/runs")
def runs(limit: int = 50) -> list[dict]:
    return list_runs(limit)


@router.get("/runs/{run_id}")
def run_detail(run_id: str) -> dict:
    report = get_run(run_id)
    if report is None:
        raise HTTPException(404, f"unknown run '{run_id}'")
    return report


@router.get("/runs/{run_id}/rejects.csv", response_class=PlainTextResponse)
def run_rejects_csv(run_id: str) -> PlainTextResponse:
    report = get_run(run_id)
    if report is None:
        raise HTTPException(404, f"unknown run '{run_id}'")
    buf = io.StringIO()
    writer = csv.writer(buf, lineterminator="\n")
    writer.writerow(["stage_index", "stage_op", "row", "rid", "message", "record"])
    for s in report["stages"]:
        if s["index"] < 0:
            continue
        for e in s["errors"]:
            writer.writerow([s["index"], s["op"], e["row"], e.get("rid"),
                             e["message"], json.dumps(e["record"], default=str)])
    return PlainTextResponse(
        buf.getvalue(), media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="flowbench-{run_id}-rejects.csv"'},
    )


class ReplayRequest(BaseModel):
    config: PipelineConfig | None = Field(default=None)


@router.post("/runs/{run_id}/replay", status_code=201)
def replay_run(run_id: str, req: ReplayRequest, request: Request) -> dict:
    """Re-run the stored config, or an override (e.g. a fixed pipeline)."""
    original = get_run(run_id)
    if original is None:
        raise HTTPException(404, f"unknown run '{run_id}'")
    config = req.config if req.config is not None else PipelineConfig(**original["config"])
    return _execute(request, config, "replay", replayed_from=run_id)


def _stage_summary(s: dict | None) -> dict | None:
    if s is None:
        return None
    return {"op": s["op"], "kind": s["kind"], "rows_in": s["rows_in"], "rows_out": s["rows_out"],
            "rejected": s["rejected"], "filtered": s["filtered"]}


def _run_summary(run_id: str, r: dict) -> dict:
    return {"run_id": run_id, "dataset_id": r["dataset_id"], "status": r["status"],
            "trigger": r.get("trigger"), "rows_in": r["rows_in"], "rows_out": r["rows_out"],
            "rejected_total": r["rejected_total"], "filtered_total": r["filtered_total"],
            "duration_ms": r["duration_ms"], "config": r["config"]}


def align_stages(sa: list[dict], sb: list[dict]) -> list[tuple[dict | None, dict | None]]:
    """Pair stages of two runs by (kind, op) using an LCS, so inserting or
    removing a stage does not shift every later comparison. Unmatched stages
    pair with None. The source stage (index 0) is always paired."""
    key = lambda s: (s["kind"], s["op"])  # noqa: E731
    a, b = sa[1:], sb[1:]
    n, m = len(a), len(b)
    lcs = [[0] * (m + 1) for _ in range(n + 1)]
    for i in range(n - 1, -1, -1):
        for j in range(m - 1, -1, -1):
            lcs[i][j] = lcs[i + 1][j + 1] + 1 if key(a[i]) == key(b[j]) else max(lcs[i + 1][j], lcs[i][j + 1])
    pairs: list[tuple[dict | None, dict | None]] = [(sa[0], sb[0])]
    i = j = 0
    while i < n and j < m:
        if key(a[i]) == key(b[j]):
            pairs.append((a[i], b[j])); i += 1; j += 1
        elif lcs[i + 1][j] >= lcs[i][j + 1]:
            pairs.append((a[i], None)); i += 1
        else:
            pairs.append((None, b[j])); j += 1
    pairs.extend((x, None) for x in a[i:])
    pairs.extend((None, y) for y in b[j:])
    return pairs


@router.get("/compare")
def compare(a: str, b: str) -> dict:
    ra, rb = get_run(a), get_run(b)
    if ra is None or rb is None:
        raise HTTPException(404, "unknown run id")
    stage_diffs = []
    for i, (sa, sb) in enumerate(align_stages(ra["stages"], rb["stages"])):
        ea = {e["message"] for e in (sa or {}).get("errors", [])}
        eb = {e["message"] for e in (sb or {}).get("errors", [])}
        stage_diffs.append({
            "index": i, "a": _stage_summary(sa), "b": _stage_summary(sb),
            "a_index": sa["index"] if sa else None, "b_index": sb["index"] if sb else None,
            "errors_only_a": sorted(ea - eb)[:50],
            "errors_only_b": sorted(eb - ea)[:50],
        })
    sa_fields = {f["name"] for f in ra.get("output_schema", [])}
    sb_fields = {f["name"] for f in rb.get("output_schema", [])}
    return {
        "a": _run_summary(a, ra), "b": _run_summary(b, rb),
        "same_config": ra["config"] == rb["config"],
        "schema": {"only_a": sorted(sa_fields - sb_fields), "only_b": sorted(sb_fields - sa_fields)},
        "stages": stage_diffs,
    }


class ScheduleRequest(BaseModel):
    config: PipelineConfig
    interval_s: int = Field(ge=MIN_INTERVAL_S, le=MAX_INTERVAL_S)


@router.post("/schedules", status_code=201)
def new_schedule(req: ScheduleRequest) -> dict:
    plan = req.config.plan()
    if not plan["valid"]:
        raise HTTPException(422, {"message": "pipeline has configuration errors", "plan": plan})
    try:
        sid = create_schedule(req.config.model_dump(), req.interval_s)
    except ValueError as exc:
        raise HTTPException(409, str(exc))
    return {"id": sid}


@router.get("/schedules")
def schedules() -> list[dict]:
    return list_schedules()


@router.delete("/schedules/{sid}")
def remove_schedule(sid: str) -> dict:
    if not delete_schedule(sid):
        raise HTTPException(404, f"unknown schedule '{sid}'")
    return {"deleted": sid}
