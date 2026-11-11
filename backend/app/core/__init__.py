"""Pipeline execution engine.

A pipeline config is a dataset id plus an ordered list of stages. Each stage
is one registry op (validator or transform). Execution is synchronous and
bounded: rows stream lazily through chained stage iterators, per-stage
samples are capped, and a wall-clock budget aborts runaway runs.

Every ingested row carries a ``_rid`` lineage id so rejected records and
surviving outputs can be traced back through the DAG.
"""

from __future__ import annotations

import csv
import io
import json
import time
from dataclasses import dataclass, field
from typing import Any, Iterator

from pydantic import BaseModel, Field, field_validator, model_validator

from app.core.planner import plan_pipeline
from app.datasets import get_dataset
from app.registry import get_op

# Public-demo safety bounds.
MAX_ROWS = 10_000          # source rows read per run
MAX_STAGES = 20            # stages per pipeline
SAMPLE_LIMIT = 50          # sampled records kept per stage per bucket
ERROR_LIMIT = 200          # validation errors recorded per stage
RUN_TIME_BUDGET_S = 10.0   # wall-clock budget for a whole run
MAX_PARAMS_BYTES = 4_096   # serialized params per stage
DISTINCT_CAP = 1_000       # distinct values tracked per field when profiling

LIMITS = {
    "max_rows": MAX_ROWS, "max_stages": MAX_STAGES, "sample_limit": SAMPLE_LIMIT,
    "error_limit": ERROR_LIMIT, "run_time_budget_s": RUN_TIME_BUDGET_S,
}


class StageConfig(BaseModel):
    kind: str = Field(pattern="^(validator|transform)$")
    op: str = Field(min_length=1, max_length=64)
    params: dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="after")
    def op_must_exist(self) -> "StageConfig":
        if get_op(self.kind, self.op) is None:
            raise ValueError(f"unknown {self.kind} op '{self.op}'")
        return self

    @field_validator("params")
    @classmethod
    def params_size(cls, v: dict[str, Any]) -> dict[str, Any]:
        if len(json.dumps(v, default=str)) > MAX_PARAMS_BYTES:
            raise ValueError("stage params too large")
        return v


class PipelineConfig(BaseModel):
    dataset_id: str = Field(min_length=1, max_length=64)
    stages: list[StageConfig] = Field(default_factory=list, max_length=MAX_STAGES)
    output_format: str = Field(default="records", pattern="^(records|csv)$")

    @model_validator(mode="after")
    def dataset_must_exist(self) -> "PipelineConfig":
        if get_dataset(self.dataset_id) is None:
            raise ValueError(f"unknown dataset '{self.dataset_id}'")
        return self

    def plan(self) -> dict:
        return plan_pipeline(self.dataset_id, [s.model_dump() for s in self.stages])


class PipelineInvalid(Exception):
    def __init__(self, plan: dict):
        super().__init__("pipeline has configuration errors")
        self.plan = plan


@dataclass
class FieldProfile:
    count: int = 0
    nulls: int = 0
    distinct: set = field(default_factory=set)
    min: Any = None
    max: Any = None
    types: dict[str, int] = field(default_factory=dict)

    def observe(self, value: Any) -> None:
        self.count += 1
        if value is None:
            self.nulls += 1
            return
        t = type(value).__name__
        self.types[t] = self.types.get(t, 0) + 1
        if len(self.distinct) < DISTINCT_CAP:
            try:
                self.distinct.add(value)
            except TypeError:
                pass
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            if self.min is None or value < self.min:
                self.min = value
            if self.max is None or value > self.max:
                self.max = value

    def to_dict(self) -> dict:
        dominant = max(self.types, key=self.types.get) if self.types else None
        return {
            "type": dominant,
            "mixed_types": len(self.types) > 1,
            "count": self.count, "nulls": self.nulls,
            "null_pct": round(100 * self.nulls / self.count, 1) if self.count else 0,
            "distinct": len(self.distinct),
            "distinct_capped": len(self.distinct) >= DISTINCT_CAP,
            "min": self.min, "max": self.max,
        }


def _observe(profile: dict[str, FieldProfile], row: dict) -> None:
    for k, v in row.items():
        if k == "_rid":
            continue
        fp = profile.get(k)
        if fp is None:
            fp = profile[k] = FieldProfile()
        fp.observe(v)


@dataclass
class StageResult:
    index: int
    kind: str
    op: str
    rows_in: int = 0
    rows_out: int = 0
    rejected: int = 0
    filtered: int = 0
    elapsed_s: float = 0.0
    errors: list[dict] = field(default_factory=list)        # {row, rid, record, message}
    sample_in: list[dict] = field(default_factory=list)
    sample_out: list[dict] = field(default_factory=list)
    sample_rejected: list[dict] = field(default_factory=list)
    profile: dict[str, FieldProfile] = field(default_factory=dict)

    def emit(self, row: dict) -> None:
        self.rows_out += 1
        _observe(self.profile, row)
        if len(self.sample_out) < SAMPLE_LIMIT:
            self.sample_out.append(dict(row))

    def reject(self, row: dict, message: str) -> None:
        self.rejected += 1
        if len(self.errors) < ERROR_LIMIT:
            self.errors.append({
                "row": self.rows_in - 1,
                "rid": row.get("_rid"),
                "record": {k: v for k, v in row.items() if k != "_rid"},
                "message": message,
            })
        if len(self.sample_rejected) < SAMPLE_LIMIT:
            self.sample_rejected.append(dict(row))

    def to_dict(self) -> dict:
        return {
            "index": self.index, "kind": self.kind, "op": self.op,
            "rows_in": self.rows_in, "rows_out": self.rows_out,
            "rejected": self.rejected, "filtered": self.filtered,
            "duration_ms": round(self.elapsed_s * 1000, 2),
            "errors": self.errors, "sample_in": self.sample_in,
            "sample_out": self.sample_out,
            "sample_rejected": self.sample_rejected,
            "profile": {k: v.to_dict() for k, v in self.profile.items()},
        }


class RunTimeout(Exception):
    pass


def _check_budget(start: float) -> None:
    if time.monotonic() - start > RUN_TIME_BUDGET_S:
        raise RunTimeout(f"run exceeded {RUN_TIME_BUDGET_S}s time budget")


def _process(cfg: StageConfig, spec, row: dict, seen: set) -> tuple[str, Any]:
    """Apply one stage to one row -> ("pass", row) | ("reject", msg) | ("filter", None)."""
    if cfg.op in ("unique", "dedupe"):
        key = tuple(row.get(f) for f in cfg.params["fields"])
        if key in seen:
            return ("reject", f"duplicate key {key}") if cfg.op == "unique" else ("filter", None)
        seen.add(key)
        return "pass", row
    try:
        result = spec.fn(row, **cfg.params)
    except Exception as exc:  # data-dependent failure (e.g. a cast) rejects the row
        return "reject", f"{cfg.op} failed: {exc}"
    if cfg.kind == "validator":
        return ("reject", result) if result is not None else ("pass", row)
    return ("filter", None) if result is None else ("pass", result)


def _run_stage(rows: Iterator[dict], cfg: StageConfig,
               result: StageResult, budget_start: float) -> Iterator[dict]:
    """Wrap a row iterator with one stage; yields passing/transformed rows.

    ``elapsed_s`` measures only this stage's own work, not upstream stages
    (time is accumulated between receiving a row and handing it on).
    """
    spec = get_op(cfg.kind, cfg.op)
    seen: set[tuple] = set()
    clock = time.perf_counter

    for row in rows:
        t0 = clock()
        if result.rows_in % 256 == 0:
            _check_budget(budget_start)
        result.rows_in += 1
        if len(result.sample_in) < SAMPLE_LIMIT:
            result.sample_in.append(dict(row))

        outcome, value = _process(cfg, spec, row, seen)
        if outcome == "reject":
            result.reject(row, value)
        elif outcome == "filter":
            result.filtered += 1
        else:
            result.emit(value)
        result.elapsed_s += clock() - t0
        if outcome == "pass":
            yield value


def _to_csv(rows: list[dict], columns: list[str]) -> str:
    buf = io.StringIO()
    writer = csv.writer(buf, lineterminator="\n")
    writer.writerow(columns)
    for r in rows:
        writer.writerow(["" if r.get(c) is None else r.get(c) for c in columns])
    return buf.getvalue()


def run_pipeline(config: PipelineConfig, trigger: str = "manual",
                 replayed_from: str | None = None) -> dict:
    """Plan, then execute a pipeline. Returns a full per-stage report dict.

    Raises ``PipelineInvalid`` when the plan has errors; nothing is executed.
    """
    plan = config.plan()
    if not plan["valid"]:
        raise PipelineInvalid(plan)

    started = time.monotonic()
    dataset = get_dataset(config.dataset_id)

    ingest = StageResult(index=-1, kind="ingest", op=dataset.id)
    stages: list[StageResult] = []
    out_rows: list[dict] = []
    out_profile: dict[str, FieldProfile] = {}
    rows_out = 0

    def source() -> Iterator[dict]:
        clock = time.perf_counter
        for rid, raw in enumerate(dataset.rows()):
            if rid >= MAX_ROWS:
                return
            t0 = clock()
            row = {"_rid": rid, **raw}
            ingest.rows_in += 1
            ingest.emit(row)
            ingest.elapsed_s += clock() - t0
            yield row

    chain: Iterator[dict] = source()
    for i, cfg in enumerate(config.stages):
        res = StageResult(index=i, kind=cfg.kind, op=cfg.op)
        stages.append(res)
        chain = _run_stage(chain, cfg, res, started)

    status = "success"
    try:
        for row in chain:
            rows_out += 1
            if len(out_rows) < SAMPLE_LIMIT:
                out_rows.append(dict(row))
            _observe(out_profile, row)
    except RunTimeout:
        status = "timeout"

    ingest.sample_in = list(ingest.sample_out)
    output_schema = plan["output_schema"]
    output: dict[str, Any] = {"format": config.output_format, "sample": out_rows,
                              "sample_size": len(out_rows)}
    if config.output_format == "csv":
        output["csv"] = _to_csv(out_rows, [f["name"] for f in output_schema])

    warnings = [{"stage": s["index"], "op": s["op"], "message": iss["message"]}
                for s in plan["stages"] for iss in s["issues"] if iss["level"] == "warning"]

    return {
        "dataset_id": config.dataset_id,
        "status": status,
        "trigger": trigger,
        "replayed_from": replayed_from,
        "duration_ms": round((time.monotonic() - started) * 1000, 2),
        "rows_in": ingest.rows_in,
        "rows_out": rows_out,
        "rejected_total": sum(s.rejected for s in stages),
        "filtered_total": sum(s.filtered for s in stages),
        "input_schema": plan["input_schema"],
        "output_schema": output_schema,
        "output_profile": {k: v.to_dict() for k, v in out_profile.items()},
        "warnings": warnings,
        "stages": [ingest.to_dict()] + [s.to_dict() for s in stages],
        "output": output,
        "config": config.model_dump(),
    }
