"""Compile-to-SQL tests.

The equivalence tests run the generated SQL in DuckDB (dev dependency) over
the same data and compare it with the Python engine: same output row count,
same columns, and identical first rows in source order.
"""

import pytest

from app.compiler import compile_sql, ident, lit
from app.core import PipelineConfig, run_pipeline
from app.presets import PRESETS
from app.settings import API_COMMON_PREFIX as P
from tests.conftest import run_body, stage

duckdb = pytest.importorskip("duckdb")


def _norm(v):
    if isinstance(v, float):
        return round(v, 9)
    if isinstance(v, int) and not isinstance(v, bool):
        return float(v)  # ints and floats compare numerically (e.g. round())
    return v


def run_sql(client, tmp_path, dataset_id, stages):
    compiled = compile_sql(dataset_id, stages)
    assert compiled["valid"], compiled["plan"]
    csv_path = tmp_path / f"{dataset_id}.csv"
    csv_path.write_text(client.get(f"{P}/datasets/{dataset_id}/download.csv").text)
    con = duckdb.connect()
    con.execute(compiled["setup_sql"].replace(f"'{dataset_id}.csv'", f"'{csv_path}'"))
    cur = con.execute(compiled["sql"])
    cols = [d[0] for d in cur.description]
    return cols, [dict(zip(cols, r)) for r in cur.fetchall()]


def assert_equivalent(client, tmp_path, dataset_id, stages):
    report = run_pipeline(PipelineConfig(**run_body(dataset_id, stages)["config"]))
    cols, rows = run_sql(client, tmp_path, dataset_id, stages)
    assert len(rows) == report["rows_out"], (dataset_id, len(rows), report["rows_out"])
    assert cols == [f["name"] for f in report["output_schema"]]
    sample = report["output"]["sample"]
    for got, want in zip(rows, sample):
        for c in cols:
            assert _norm(got[c]) == _norm(want[c]), (c, got[c], want[c])
    return report


CASES = {
    "iot-validate-enrich": ("iot-sensors", [
        stage("validator", "not_null", fields=["reading_id", "temperature_c"]),
        stage("validator", "range", field="humidity_pct", min=30, max=60),
        stage("validator", "unique", fields=["device_id", "site"]),
        stage("transform", "join_lookup", on="device_id", table="devices", how="left"),
        stage("transform", "derive_column", target="temp_scaled", fn="multiply", args=[{"field": "temperature_c"}, 1.8]),
        stage("transform", "drop_columns", columns=["battery_pct"]),
        stage("transform", "upper", field="site"),
    ]),
    "orders-shape": ("orders", [
        stage("validator", "regex", field="country", pattern="[A-Z]{2}"),
        stage("validator", "allowed_values", field="channel", values=["web", "app"]),
        stage("transform", "rename", mapping={"sku": "product_sku"}),
        stage("transform", "join_lookup", on="product_sku", table="products", how="inner"),
        stage("transform", "cast", field="quantity", to="string"),
        stage("transform", "dedupe", fields=["customer_id"]),
        stage("transform", "derive_column", target="label", fn="concat", args=[{"field": "channel"}, "-x"]),
        stage("transform", "filter", field="unit_cost", op="gte", value=10),
    ]),
    "flights-filters": ("flights", [
        stage("transform", "filter", field="cancelled", op="eq", value=False),
        stage("transform", "filter", field="dep_delay_min", op="gte", value=15),
        stage("validator", "type_check", field="distance_km", expected="integer"),
        stage("transform", "join_lookup", on="origin", table="airports"),
        stage("transform", "derive_column", target="delay_h", fn="divide", args=[{"field": "dep_delay_min"}, 60]),
        stage("transform", "lower", field="airline"),
    ]),
    "weblogs-ops": ("web-logs", [
        stage("transform", "filter", field="status", op="in", value=[500, 502, 503]),
        stage("transform", "filter", field="user_agent", op="ne", value="bot"),
        stage("transform", "filter", field="path", op="contains", value="/"),
        stage("transform", "derive_column", target="lat_abs", fn="abs", args=[{"field": "latency_ms"}]),
        stage("transform", "derive_column", target="lat_r", fn="round", args=[{"field": "latency_ms"}, 0]),
        stage("transform", "derive_column", target="kb", fn="divide", args=[{"field": "bytes"}, 1024]),
    ]),
}


@pytest.mark.parametrize("case", CASES, ids=list(CASES))
def test_sql_matches_engine(client, tmp_path, case):
    dataset_id, stages = CASES[case]
    report = assert_equivalent(client, tmp_path, dataset_id, stages)
    assert report["rows_out"] > 0


@pytest.mark.parametrize("pid", ["vitals-qc", "txn-enrichment", "web-error-triage", "flight-delay-report"])
def test_presets_compile_and_match(client, tmp_path, pid):
    cfg = next(p for p in PRESETS if p["id"] == pid)["config"]
    assert_equivalent(client, tmp_path, cfg["dataset_id"], cfg["stages"])


def test_quoting_is_injection_safe():
    assert ident('we"ird') == '"we""ird"'
    assert lit("O'Brien'); DROP TABLE x; --") == "'O''Brien''); DROP TABLE x; --'"
    assert lit(True) == "TRUE" and lit(None) == "NULL" and lit(2.5) == "2.5"


def test_invalid_pipeline_does_not_compile(client):
    r = client.post(f"{P}/compile/sql", json={"dataset_id": "transactions",
                                              "stages": [stage("validator", "not_null", fields=["temperature_c"])]})
    assert r.status_code == 422 and r.json()["detail"]["plan"]["valid"] is False


def test_compile_endpoint_shape_and_notes(client):
    r = client.post(f"{P}/compile/sql", json={"dataset_id": "iot-sensors-faulty", "stages": [
        stage("validator", "type_check", field="temperature_c", expected="float")]})
    body = r.json()
    assert r.status_code == 200 and body["dialect"] == "duckdb"
    assert "WITH source AS" in body["sql"] and "s1_type_check" in body["sql"]
    assert "CREATE OR REPLACE TABLE iot_sensors_faulty" in body["setup_sql"]
    assert any("TRY_CAST" in n for n in body["notes"]) and any("injected type errors" in n for n in body["notes"])


def test_dataset_csv_download(client):
    r = client.get(f"{P}/datasets/flights/download.csv")
    lines = r.text.strip().split("\n")
    assert r.headers["content-type"].startswith("text/csv")
    assert lines[0].startswith("flight_id,airline") and len(lines) == 1501
    assert ",false" in r.text or ",true" in r.text
    assert client.get(f"{P}/datasets/nope/download.csv").status_code == 404


def test_rename_keeps_column_position():
    from app.registry import transform_rename
    assert list(transform_rename({"a": 1, "b": 2, "c": 3}, {"b": "x"})) == ["a", "x", "c"]
    # renaming onto an existing name replaces that column
    assert transform_rename({"a": 1, "b": 2}, {"a": "b"}) == {"b": 1}
