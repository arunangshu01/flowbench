import itertools

import pytest

from app.core import PipelineConfig, run_pipeline
from app.datasets import DATASETS, LOOKUPS
from app.presets import PRESETS
from app.settings import API_COMMON_PREFIX as P

CHECK = {
    "string": lambda v: isinstance(v, str),
    "timestamp": lambda v: isinstance(v, str) and v.endswith("Z") and "T" in v,
    "integer": lambda v: isinstance(v, int) and not isinstance(v, bool),
    "float": lambda v: isinstance(v, (int, float)) and not isinstance(v, bool),
    "boolean": lambda v: isinstance(v, bool),
}
CLEAN = [d for d in DATASETS.values() if not d.id.endswith("-faulty")]

# dataset -> [(field, lookup table)] every value must resolve
JOIN_KEYS = {
    "iot-sensors": [("device_id", "devices")],
    "transactions": [("merchant", "merchants")],
    "vitals": [("ward", "wards")],
    "orders": [("sku", "products")],
    "shipments": [("carrier", "carriers")],
    "weather": [("station_id", "stations")],
    "flights": [("origin", "airports"), ("destination", "airports")],
}


def test_catalog_covers_many_domains():
    assert len(DATASETS) >= 11
    assert {d.domain for d in DATASETS.values()} >= {
        "iot", "finance", "healthcare", "retail", "observability", "logistics", "climate", "aviation", "hr"}


@pytest.mark.parametrize("ds", DATASETS.values(), ids=lambda d: d.id)
def test_deterministic_and_counted(ds):
    first = list(itertools.islice(ds.rows(), 50))
    assert first == list(itertools.islice(ds.rows(), 50))
    assert sum(1 for _ in ds.rows()) == ds.row_count


@pytest.mark.parametrize("ds", CLEAN, ids=lambda d: d.id)
def test_clean_datasets_conform_to_schema(ds):
    names = [f.name for f in ds.schema]
    keys = set()
    for row in ds.rows():
        assert list(row) == names
        for f in ds.schema:
            assert CHECK[f.type](row[f.name]), (ds.id, f.name, row[f.name])
        keys.add(row[names[0]])
    assert len(keys) == ds.row_count, f"{ds.id}: primary key not unique"


@pytest.mark.parametrize("dataset_id,joins", JOIN_KEYS.items())
def test_join_keys_resolve(dataset_id, joins):
    for field, table in joins:
        values = {r[field] for r in DATASETS[dataset_id].rows()}
        assert values <= set(LOOKUPS[table]), (dataset_id, field, values - set(LOOKUPS[table]))


def test_faulty_orders_preset_catches_every_defect_kind():
    preset = next(p for p in PRESETS if p["id"] == "order-quality-gate")
    report = run_pipeline(PipelineConfig(**preset["config"]))
    by_op = {s["op"]: s for s in report["stages"][1:]}
    for op in ("not_null", "range", "type_check", "regex", "unique"):
        assert by_op[op]["rejected"] > 0, op
    assert by_op["join_lookup"]["filtered"] > 0  # unknown SKUs dropped by the inner join
    assert all(isinstance(r["line_total"], float) for r in report["output"]["sample"])


def test_semantic_ranges_hold():
    flights = list(DATASETS["flights"].rows())
    assert all(r["dep_delay_min"] == 0 for r in flights if r["cancelled"])
    assert all(r["distance_km"] > 0 for r in flights)
    ships = list(DATASETS["shipments"].rows())
    assert all(r["transit_days"] >= r["eta_days"] > 0 for r in ships)
    emps = list(DATASETS["employees"].rows())
    assert all(1 <= r["level"] <= 7 and 1.0 <= r["rating"] <= 5.0 for r in emps)


def test_new_presets_run(client):
    for pid in ("web-error-triage", "flight-delay-report"):
        cfg = next(p for p in PRESETS if p["id"] == pid)["config"]
        r = client.post(f"{P}/runs", json={"config": cfg})
        assert r.status_code == 201, r.json()
        assert 0 < r.json()["rows_out"] < r.json()["rows_in"]


def test_datasets_endpoint_exposes_domain(client):
    rows = client.get(f"{P}/datasets").json()
    assert all("domain" in d and "faulty" in d for d in rows)
    assert next(d for d in rows if d["id"] == "orders-faulty")["faulty"] is True
