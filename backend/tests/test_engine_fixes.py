"""Regression tests for engine/scheduler bugs found during the v1 review."""

import csv
import io
import time

from app.api import _client_key
from app.core import PipelineConfig, run_pipeline
from app.scheduler import run_due_schedules
from tests.conftest import run_body, stage
from app.settings import API_COMMON_PREFIX as P


def run(dataset_id, stages, fmt="records"):
    return run_pipeline(PipelineConfig(**run_body(dataset_id, stages, fmt)["config"]))


def test_clean_datasets_respect_documented_ranges():
    r = run("iot-sensors", [
        stage("validator", "range", field="battery_pct", min=0, max=100),
        stage("validator", "range", field="humidity_pct", min=0, max=100),
    ])
    assert r["rejected_total"] == 0


def test_ingest_counts_source_rows_not_output():
    r = run("iot-sensors-faulty", [stage("validator", "not_null", fields=["temperature_c"])])
    ingest = r["stages"][0]
    assert ingest["rows_in"] == ingest["rows_out"] == 2000
    assert r["rows_in"] == 2000 and r["rows_out"] < 2000


def test_counts_conserve_through_chain():
    r = run("iot-sensors-faulty", [
        stage("validator", "not_null", fields=["temperature_c", "device_id"]),
        stage("transform", "dedupe", fields=["reading_id"]),
        stage("validator", "range", field="humidity_pct", min=0, max=100),
    ])
    for s in r["stages"][1:]:
        assert s["rows_in"] == s["rows_out"] + s["rejected"] + s["filtered"]
    for up, down in zip(r["stages"][1:], r["stages"][2:]):
        assert up["rows_out"] == down["rows_in"]
    assert r["stages"][-1]["rows_out"] == r["rows_out"]


def test_stage_durations_are_measured():
    r = run("iot-sensors", [stage("validator", "not_null", fields=["reading_id"])])
    assert r["stages"][1]["duration_ms"] > 0
    assert r["stages"][0]["duration_ms"] > 0


def test_cast_failure_rejects_row():
    r = run("iot-sensors-faulty", [stage("transform", "cast", field="temperature_c", to="float")])
    s = r["stages"][1]
    assert s["rejected"] > 0
    assert all("cast failed" in e["message"] for e in s["errors"])
    assert not any(k.startswith("__") for row in r["output"]["sample"] for k in row)


def test_csv_output_is_escaped():
    r = run("vitals", [
        stage("transform", "derive_column", target="label", fn="concat",
              args=[{"field": "ward"}, ', "quoted"']),
    ], fmt="csv")
    rows = list(csv.reader(io.StringIO(r["output"]["csv"])))
    header, first = rows[0], rows[1]
    assert len(first) == len(header)
    assert first[header.index("label")].endswith(', "quoted"')


def test_mixed_type_profile_flag():
    r = run("iot-sensors-faulty", [])
    prof = r["output_profile"]["temperature_c"]
    assert prof["mixed_types"] is True and prof["type"] == "float"


def test_scheduler_executes_due_schedules(client):
    sid = client.post(f"{P}/schedules", json={**run_body("vitals", [
        stage("validator", "range", field="heart_rate", min=20, max=220)]), "interval_s": 60}).json()["id"]
    new_ids = run_due_schedules(time.time())
    assert len(new_ids) >= 1
    detail = client.get(f"{P}/runs/{new_ids[0]}").json()
    assert detail["trigger"] == "schedule" and detail["rows_out"] > 0
    # not due again until the interval elapses
    assert run_due_schedules(time.time()) == []
    client.delete(f"{P}/schedules/{sid}")


def test_schedule_rejects_invalid_pipeline(client):
    r = client.post(f"{P}/schedules", json={**run_body("transactions", [
        stage("validator", "not_null", fields=["temperature_c"])]), "interval_s": 60})
    assert r.status_code == 422


def test_replay_records_parent(client):
    rid = client.post(f"{P}/runs", json=run_body("vitals", [])).json()["run_id"]
    child = client.post(f"{P}/runs/{rid}/replay", json={"config": None}).json()
    assert child["replayed_from"] == rid
    hist = {h["id"]: h for h in client.get(f"{P}/runs").json()}
    assert hist[child["run_id"]]["replayed_from"] == rid
    assert hist[child["run_id"]]["stage_count"] == 0


def test_compare_aligns_stages_by_operation(client):
    a = client.post(f"{P}/runs", json=run_body("iot-sensors-faulty", [
        stage("validator", "not_null", fields=["temperature_c"]),
        stage("validator", "type_check", field="temperature_c", expected="float"),
        stage("validator", "range", field="humidity_pct", min=0, max=100),
    ])).json()["run_id"]
    b = client.post(f"{P}/runs", json=run_body("iot-sensors-faulty", [
        stage("validator", "not_null", fields=["temperature_c"]),
        stage("validator", "range", field="humidity_pct", min=0, max=100),
    ])).json()["run_id"]
    rows = client.get(f"{P}/compare?a={a}&b={b}").json()["stages"]
    pairs = [((r["a"] or {}).get("op"), (r["b"] or {}).get("op")) for r in rows]
    assert pairs == [("iot-sensors-faulty", "iot-sensors-faulty"), ("not_null", "not_null"),
                     ("type_check", None), ("range", "range")]


def test_rejects_csv_is_parseable(client):
    rid = client.post(f"{P}/runs", json=run_body("iot-sensors-faulty", [
        stage("validator", "not_null", fields=["temperature_c"])])).json()["run_id"]
    r = client.get(f"{P}/runs/{rid}/rejects.csv")
    assert r.headers["content-type"].startswith("text/csv")
    rows = list(csv.DictReader(io.StringIO(r.text)))
    assert rows and rows[0]["stage_op"] == "not_null" and rows[0]["record"].startswith("{")


def test_client_key_never_trusts_forwarded_headers(monkeypatch):
    class Req:
        headers = {"x-forwarded-for": "6.6.6.6, 1.2.3.4, 10.0.0.1"}
        client = type("C", (), {"host": "10.9.9.9"})()

    import app.api as api
    monkeypatch.setattr(api, "RATE_LIMIT_SCOPE", "client")
    assert _client_key(Req()) == "10.9.9.9"   # spoofable header ignored
    monkeypatch.setattr(api, "RATE_LIMIT_SCOPE", "global")
    assert _client_key(Req()) == "global"     # production: one shared budget


def test_global_scope_shares_one_budget(client, monkeypatch):
    import app.api as api
    from app.core.ratelimit import RateLimiter
    monkeypatch.setattr(api, "RATE_LIMIT_SCOPE", "global")
    monkeypatch.setattr(api, "limiter", RateLimiter(rate_per_min=1, capacity=2))
    body = run_body("vitals", [])
    hdr = lambda ip: {"x-forwarded-for": ip}  # noqa: E731
    assert client.post(f"{P}/runs", json=body, headers=hdr("1.1.1.1")).status_code == 201
    assert client.post(f"{P}/runs", json=body, headers=hdr("2.2.2.2")).status_code == 201
    r = client.post(f"{P}/runs", json=body, headers=hdr("3.3.3.3"))  # new "IP" does not get a new bucket
    assert r.status_code == 429 and "for this demo" in r.json()["detail"]


def test_security_headers(client):
    r = client.get(f"{P}/health")
    assert r.headers["x-content-type-options"] == "nosniff"
    assert r.headers["cache-control"] == "no-store"
