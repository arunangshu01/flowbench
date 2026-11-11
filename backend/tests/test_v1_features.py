from app.core import PipelineConfig, run_pipeline
from app.settings import API_COMMON_PREFIX as P


def cfg(stages, dataset_id="iot-sensors-faulty", output_format="records"):
    return PipelineConfig(dataset_id=dataset_id, stages=stages,
                          output_format=output_format)


def stage(kind, op_name, **params):
    return {"kind": kind, "op": op_name, "params": params}


def test_lineage_rid_on_output_and_errors():
    report = run_pipeline(cfg([
        stage("validator", "not_null", fields=["temperature_c"]),
    ]))
    out = report["output"]["sample"][0]
    assert isinstance(out["_rid"], int)
    err = report["stages"][1]["errors"][0]
    assert isinstance(err["rid"], int)
    assert "_rid" not in err["record"]


def test_output_schema_and_profile():
    report = run_pipeline(cfg([
        stage("transform", "derive_column", target="t2", fn="multiply",
              args=[{"field": "temperature_c"}, 2]),
        stage("transform", "drop_columns", columns=["battery_pct"]),
    ], dataset_id="iot-sensors"))
    names = [f["name"] for f in report["output_schema"]]
    assert "t2" in names and "battery_pct" not in names
    prof = report["output_profile"]["temperature_c"]
    assert prof["count"] == 2000 and prof["nulls"] == 0
    assert prof["min"] <= prof["max"] and prof["distinct"] > 100


def test_stage_profiles_present():
    report = run_pipeline(cfg([
        stage("validator", "not_null", fields=["temperature_c"]),
    ]))
    stage_prof = report["stages"][1]["profile"]
    assert "temperature_c" in stage_prof


def test_dedupe_filters_duplicates():
    report = run_pipeline(cfg([
        stage("transform", "dedupe", fields=["reading_id"]),
    ]))
    s = report["stages"][1]
    # dupes are filtered, not rejected
    assert s["rejected"] == 0
    assert s["filtered"] > 0
    assert s["rows_in"] == s["rows_out"] + s["filtered"]


def test_join_lookup_left_and_inner():
    left = run_pipeline(cfg([
        stage("transform", "join_lookup", on="device_id",
              table="devices", how="left"),
    ], dataset_id="iot-sensors"))
    row = left["output"]["sample"][0]
    assert row["model"].startswith("sense-") and "firmware" in row

    # inner join with a key that never matches filters everything
    inner = run_pipeline(cfg([
        stage("transform", "join_lookup", on="site",
              table="devices", how="inner"),
    ], dataset_id="iot-sensors"))
    assert inner["rows_out"] == 0
    assert inner["stages"][1]["filtered"] == 2000


def test_lookups_endpoint(client):
    tables = {t["name"] for t in client.get(f"{P}/lookups").json()}
    assert {"devices", "merchants", "wards", "products", "carriers", "stations", "airports"} == tables


def test_presets_endpoint(client):
    presets = client.get(f"{P}/presets").json()
    assert len(presets) >= 3
    for p in presets:
        assert PipelineConfig(**p["config"])  # every preset is a valid config


def test_compare_endpoint(client):
    bad = client.post(f"{P}/runs", json={"config": {
        "dataset_id": "iot-sensors-faulty",
        "stages": [{"kind": "validator", "op": "not_null",
                    "params": {"fields": ["temperature_c"]}}],
        "output_format": "records"}}).json()["run_id"]
    good = client.post(f"{P}/runs", json={"config": {
        "dataset_id": "iot-sensors",
        "stages": [{"kind": "validator", "op": "not_null",
                    "params": {"fields": ["temperature_c"]}}],
        "output_format": "records"}}).json()["run_id"]

    diff = client.get(f"{P}/compare?a={bad}&b={good}").json()
    assert diff["a"]["rejected_total"] > diff["b"]["rejected_total"]
    assert diff["stages"][1]["errors_only_a"]
    assert client.get(f"{P}/compare?a=nope&b=nope").status_code == 404


def test_rejects_csv_export(client):
    run_id = client.post(f"{P}/runs", json={"config": {
        "dataset_id": "iot-sensors-faulty",
        "stages": [{"kind": "validator", "op": "not_null",
                    "params": {"fields": ["temperature_c"]}}],
        "output_format": "records"}}).json()["run_id"]
    r = client.get(f"{P}/runs/{run_id}/rejects.csv")
    assert r.status_code == 200
    lines = r.text.strip().split("\n")
    assert lines[0].startswith("stage_index")
    assert len(lines) > 1
    assert "not_null" in lines[1]


def test_schedules_crud(client):
    r = client.post(f"{P}/schedules", json={
        "config": {"dataset_id": "iot-sensors", "stages": [],
                   "output_format": "records"},
        "interval_s": 60})
    assert r.status_code == 201
    sid = r.json()["id"]
    scheds = client.get(f"{P}/schedules").json()
    assert any(s["id"] == sid for s in scheds)
    assert client.delete(f"{P}/schedules/{sid}").status_code == 200
    assert client.delete(f"{P}/schedules/{sid}").status_code == 404


def test_trigger_recorded(client):
    run_id = client.post(f"{P}/runs", json={"config": {
        "dataset_id": "iot-sensors", "stages": [],
        "output_format": "records"}}).json()["run_id"]
    hist = client.get(f"{P}/runs").json()
    assert next(h for h in hist if h["id"] == run_id)["trigger"] == "manual"
    replay_id = client.post(f"{P}/runs/{run_id}/replay",
                            json={"config": None}).json()["run_id"]
    hist = client.get(f"{P}/runs").json()
    assert next(h for h in hist if h["id"] == replay_id)["trigger"] == "replay"
