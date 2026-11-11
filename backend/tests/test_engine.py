from app.core import PipelineConfig, run_pipeline
from app.datasets import get_dataset


def cfg(stages, dataset_id="iot-sensors-faulty", output_format="records"):
    return PipelineConfig(dataset_id=dataset_id, stages=stages,
                          output_format=output_format)


def stage(kind, op_name, **params):
    return {"kind": kind, "op": op_name, "params": params}


def test_datasets_are_deterministic():
    ds = get_dataset("transactions")
    first = [r["txn_id"] for r in ds.rows()]
    second = [r["txn_id"] for r in ds.rows()]
    assert first == second and len(first) == 1500


def test_not_null_rejects_faulty_rows():
    report = run_pipeline(cfg([
        stage("validator", "not_null", fields=["temperature_c"]),
    ]))
    s = report["stages"][1]
    assert s["rejected"] > 0
    assert s["rows_in"] == s["rows_out"] + s["rejected"]
    assert all("null" in e["message"] for e in s["errors"])
    assert len(s["sample_rejected"]) > 0


def test_type_check_catches_wrong_type():
    report = run_pipeline(cfg([
        stage("validator", "type_check", field="temperature_c", expected="float"),
    ]))
    s = report["stages"][1]
    assert s["rejected"] > 0
    assert any("expected float" in e["message"] for e in s["errors"])


def test_range_rejects_out_of_range():
    report = run_pipeline(cfg([
        stage("validator", "range", field="humidity_pct", min=0, max=100),
    ]))
    s = report["stages"][1]
    assert s["rejected"] > 0
    assert all("maximum" in e["message"] or "minimum" in e["message"]
               for e in s["errors"])


def test_unique_rejects_duplicate_ids():
    report = run_pipeline(cfg([
        stage("validator", "unique", fields=["reading_id"]),
    ]))
    s = report["stages"][1]
    assert s["rejected"] > 0
    assert all("duplicate" in e["message"] for e in s["errors"])


def test_clean_dataset_passes_full_validation():
    report = run_pipeline(cfg([
        stage("validator", "not_null", fields=["reading_id", "temperature_c"]),
        stage("validator", "range", field="humidity_pct", min=0, max=100),
        stage("validator", "unique", fields=["reading_id"]),
    ], dataset_id="iot-sensors"))
    assert report["status"] == "success"
    assert report["rejected_total"] == 0
    assert report["rows_out"] == 2000


def test_transform_chain_derive_and_filter():
    report = run_pipeline(cfg([
        stage("transform", "derive_column", target="temperature_f",
              fn="add",
              args=[{"field": "temperature_c"}, {"field": "temperature_c"}]),
        stage("transform", "filter", field="site", op="eq",
              value="plant-north"),
        stage("transform", "rename", mapping={"temperature_f": "temp_f"}),
        stage("transform", "drop_columns", columns=["battery_pct"]),
    ], dataset_id="iot-sensors"))
    s = report["stages"]
    filter_stage = s[3]
    assert filter_stage["filtered"] + filter_stage["rows_out"] == filter_stage["rows_in"]
    out = report["output"]["sample"][0]
    assert "temp_f" in out and "battery_pct" not in out
    assert out["site"] == "plant-north"


def test_csv_output():
    report = run_pipeline(cfg([], dataset_id="vitals", output_format="csv"))
    assert report["output"]["format"] == "csv"
    lines = report["output"]["csv"].split("\n")
    assert lines[0].startswith("record_id")
    assert len(lines) > 1


def test_unknown_op_rejected():
    import pytest
    from pydantic import ValidationError
    with pytest.raises(ValidationError):
        cfg([stage("validator", "does_not_exist")])


def test_unknown_dataset_rejected():
    import pytest
    from pydantic import ValidationError
    with pytest.raises(ValidationError):
        PipelineConfig(dataset_id="nope", stages=[])
