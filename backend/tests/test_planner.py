import time

import pytest

from app.core import PipelineConfig, PipelineInvalid, run_pipeline
from app.core.planner import plan_pipeline
from tests.conftest import run_body, stage
from app.settings import API_COMMON_PREFIX as P


def errors(plan, i):
    return [x["message"] for x in plan["stages"][i]["issues"] if x["level"] == "error"]


def warnings(plan, i):
    return [x["message"] for x in plan["stages"][i]["issues"] if x["level"] == "warning"]


# ---- field references & schema propagation --------------------------------

def test_wrong_dataset_fields_are_errors():
    # the classic mistake: IoT stages pointed at the transactions dataset
    plan = plan_pipeline("transactions", [stage("validator", "not_null", fields=["temperature_c"])])
    assert not plan["valid"]
    assert "field 'temperature_c' does not exist at this stage" in errors(plan, 0)


def test_rename_propagates_schema():
    ok = plan_pipeline("iot-sensors", [
        stage("transform", "rename", mapping={"temperature_c": "temp"}),
        stage("validator", "range", field="temp", min=-50, max=80),
    ])
    assert ok["valid"]
    assert "temp" in [f["name"] for f in ok["output_schema"]]

    stale = plan_pipeline("iot-sensors", [
        stage("transform", "rename", mapping={"temperature_c": "temp"}),
        stage("validator", "range", field="temperature_c", min=0),
    ])
    assert not stale["valid"]
    assert errors(stale, 1) == ["field 'temperature_c' does not exist at this stage"]


def test_drop_then_reference_is_error():
    plan = plan_pipeline("vitals", [
        stage("transform", "drop_columns", columns=["ward"]),
        stage("transform", "upper", field="ward"),
    ])
    assert not plan["valid"] and errors(plan, 1)


def test_join_lookup_fields_usable_downstream():
    plan = plan_pipeline("transactions", [
        stage("transform", "join_lookup", on="merchant", table="merchants"),
        stage("transform", "filter", field="risk_tier", op="eq", value="high"),
    ])
    assert plan["valid"]
    names = [f["name"] for f in plan["output_schema"]]
    assert {"industry", "risk_tier"} <= set(names)


def test_derive_and_cast_types():
    plan = plan_pipeline("vitals", [
        stage("transform", "derive_column", target="tag", fn="concat",
              args=[{"field": "ward"}, "-x"]),
        stage("transform", "cast", field="heart_rate", to="string"),
    ])
    types = {f["name"]: f["type"] for f in plan["output_schema"]}
    assert types["tag"] == "string" and types["heart_rate"] == "string"


# ---- param validation ------------------------------------------------------

@pytest.mark.parametrize("st, needle", [
    (stage("validator", "range", field="humidity_pct"), "at least one of min/max"),
    (stage("validator", "range", field="humidity_pct", min=10, max=1), "greater than max"),
    (stage("validator", "not_null"), "missing required param 'fields'"),
    (stage("validator", "not_null", fields=[]), "'fields' must be a list"),
    (stage("validator", "not_null", fields=["site"], bogus=1), "unknown param 'bogus'"),
    (stage("validator", "type_check", field="site", expected="date"), "must be one of"),
    (stage("validator", "regex", field="site", pattern="(a+)+$"), "nested quantifiers"),
    (stage("validator", "regex", field="site", pattern="[unclosed"), "invalid regex"),
    (stage("transform", "derive_column", target="x", fn="abs",
           args=[{"field": "temperature_c"}, 2]), "abs takes 1 argument"),
    (stage("transform", "derive_column", target="x", fn="add",
           args=[{"col": "temperature_c"}, 1]), 'look like {"field"'),
    (stage("transform", "join_lookup", on="device_id", table="planets"), "must be one of"),
])
def test_param_errors(st, needle):
    plan = plan_pipeline("iot-sensors", [st])
    assert not plan["valid"]
    assert any(needle in m for m in errors(plan, 0)), errors(plan, 0)


def test_warnings_do_not_block():
    plan = plan_pipeline("iot-sensors", [stage("validator", "range", field="site", min=0)])
    assert plan["valid"]
    assert "every row will be rejected" in warnings(plan, 0)[0]
    report = run_pipeline(PipelineConfig(**run_body("iot-sensors", [
        stage("validator", "range", field="site", min=0)])["config"]))
    assert report["rows_out"] == 0 and report["warnings"]


def test_run_pipeline_refuses_invalid_plan():
    cfg = PipelineConfig(**run_body("transactions", [
        stage("validator", "not_null", fields=["temperature_c"])])["config"])
    with pytest.raises(PipelineInvalid):
        run_pipeline(cfg)


# ---- API -------------------------------------------------------------------

def test_validate_endpoint(client):
    r = client.post(f"{P}/validate", json={"dataset_id": "transactions", "stages": [
        stage("validator", "not_null", fields=["temperature_c"]),
        stage("validator", "frobnicate"),
    ]})
    assert r.status_code == 200
    body = r.json()
    assert body["valid"] is False
    assert errors(body, 1) == ["unknown validator op 'frobnicate'"]


def test_invalid_run_returns_plan(client):
    r = client.post(f"{P}/runs", json=run_body("transactions", [
        stage("validator", "not_null", fields=["temperature_c"])]))
    assert r.status_code == 422
    detail = r.json()["detail"]
    assert detail["plan"]["valid"] is False
    # nothing executed, nothing stored
    assert all(h["dataset_id"] != "transactions" or h["rows_out"] for h in client.get(f"{P}/runs").json())


def test_meta(client):
    m = client.get(f"{P}/meta").json()
    assert m["limits"]["max_rows"] == 10_000 and m["version"]


def test_every_preset_plans_clean(client):
    for p in client.get(f"{P}/presets").json():
        plan = PipelineConfig(**p["config"]).plan()
        assert plan["valid"], (p["id"], plan)
        assert not any(i["level"] == "warning" for s in plan["stages"] for i in s["issues"]), p["id"]


def test_registry_has_structured_params(client):
    reg = client.get(f"{P}/registry").json()
    rng = next(v for v in reg["validators"] if v["name"] == "range")
    assert [p["name"] for p in rng["params"]] == ["field", "min", "max"]
    assert rng["params"][0]["type"] == "field" and rng["params"][1]["required"] is False
    join = next(t for t in reg["transforms"] if t["name"] == "join_lookup")
    assert set(next(p for p in join["params"] if p["name"] == "table")["options"]) == {"devices", "merchants", "wards", "products", "carriers", "stations", "airports"}
