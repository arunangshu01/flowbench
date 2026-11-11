from app.core.ratelimit import RateLimiter
from app.settings import API_COMMON_PREFIX as P


def test_routes_and_docs_live_under_common_prefix(client):
    assert P == "/flowbench/api/v1"
    assert client.get(f"{P}/docs").status_code == 200
    spec = client.get(f"{P}/openapi.json").json()
    assert spec["paths"] and all(path.startswith(P) for path in spec["paths"])
    assert client.get("/api/health").status_code == 404


def test_health(client):
    assert client.get(f"{P}/health").json() == {"status": "ok"}


def test_datasets_listed(client):
    datasets = client.get(f"{P}/datasets").json()
    ids = {d["id"] for d in datasets}
    assert {"iot-sensors", "iot-sensors-faulty", "transactions", "vitals"} <= ids
    assert all(d["row_count"] > 0 and d["schema"] for d in datasets)


def test_dataset_sample(client):
    r = client.get(f"{P}/datasets/transactions/sample?n=5").json()
    assert len(r["rows"]) == 5
    assert client.get(f"{P}/datasets/nope/sample").status_code == 404


def test_registry(client):
    reg = client.get(f"{P}/registry").json()
    names = {v["name"] for v in reg["validators"]}
    assert {"not_null", "type_check", "range", "unique"} <= names
    assert {t["name"] for t in reg["transforms"]} >= {"filter", "derive_column"}


def _run_payload(**over):
    payload = {
        "config": {
            "dataset_id": "iot-sensors-faulty",
            "stages": [
                {"kind": "validator", "op": "not_null",
                 "params": {"fields": ["temperature_c"]}},
                {"kind": "transform", "op": "drop_columns",
                 "params": {"columns": ["battery_pct"]}},
            ],
            "output_format": "records",
        }
    }
    payload["config"].update(over)
    return payload


def test_create_and_fetch_run(client):
    r = client.post(f"{P}/runs", json=_run_payload())
    assert r.status_code == 201
    report = r.json()
    assert report["run_id"]
    assert report["rejected_total"] > 0
    assert report["stages"][1]["errors"]

    fetched = client.get(f"{P}/runs/{report['run_id']}")
    assert fetched.status_code == 200
    assert fetched.json()["run_id"] == report["run_id"]

    history = client.get(f"{P}/runs").json()
    assert any(h["id"] == report["run_id"] for h in history)


def test_replay_same_config(client):
    run_id = client.post(f"{P}/runs", json=_run_payload()).json()["run_id"]
    r = client.post(f"{P}/runs/{run_id}/replay", json={"config": None})
    assert r.status_code == 201
    replayed = r.json()
    assert replayed["replayed_from"] == run_id
    assert replayed["run_id"] != run_id
    assert replayed["rows_out"] > 0


def test_replay_with_fixed_config(client):
    # original run rejects rows; replay with a stricter+fixing pipeline differs
    run_id = client.post(f"{P}/runs", json=_run_payload()).json()["run_id"]
    fixed = _run_payload(stages=[
        {"kind": "validator", "op": "not_null", "params": {"fields": ["reading_id"]}},
    ])
    r = client.post(f"{P}/runs/{run_id}/replay", json=fixed)
    assert r.status_code == 201
    assert client.post(f"{P}/runs/nope/replay", json={"config": None}).status_code == 404


def test_invalid_config_422(client):
    r = client.post(f"{P}/runs", json={"config": {
        "dataset_id": "iot-sensors",
        "stages": [{"kind": "validator", "op": "bogus", "params": {}}],
    }})
    assert r.status_code == 422


def test_rate_limiter():
    rl = RateLimiter(rate_per_min=60, capacity=3)
    assert all(rl.allow("ip1") for _ in range(3))
    assert not rl.allow("ip1")
    assert rl.allow("ip2")
