"""Named preset pipelines shipped with Flowbench for one-click demos."""

PRESETS = [
    {
        "id": "strict-sensor-ingest",
        "name": "Strict sensor ingestion",
        "description": (
            "Full quality gate for IoT readings: required fields, humidity in "
            "physical range, unique reading IDs, then a lookup join for device "
            "metadata. Run on the faulty dataset to see rejections at each gate."
        ),
        "config": {
            "dataset_id": "iot-sensors-faulty",
            "stages": [
                {"kind": "validator", "op": "not_null",
                 "params": {"fields": ["reading_id", "device_id", "temperature_c"]}},
                {"kind": "validator", "op": "type_check",
                 "params": {"field": "temperature_c", "expected": "float"}},
                {"kind": "validator", "op": "range",
                 "params": {"field": "humidity_pct", "min": 0, "max": 100}},
                {"kind": "validator", "op": "unique",
                 "params": {"fields": ["reading_id"]}},
                {"kind": "transform", "op": "join_lookup",
                 "params": {"on": "device_id", "table": "devices", "how": "left"}},
            ],
            "output_format": "records",
        },
    },
    {
        "id": "txn-enrichment",
        "name": "Transaction enrichment",
        "description": (
            "Filter to larger transactions, tag with merchant metadata, and "
            "derive a fee estimate. Demonstrates filter + join_lookup + derive_column."
        ),
        "config": {
            "dataset_id": "transactions",
            "stages": [
                {"kind": "transform", "op": "filter",
                 "params": {"field": "amount", "op": "gte", "value": 100}},
                {"kind": "transform", "op": "join_lookup",
                 "params": {"on": "merchant", "table": "merchants", "how": "left"}},
                {"kind": "transform", "op": "derive_column",
                 "params": {"target": "fee_est", "fn": "multiply",
                            "args": [{"field": "amount"}, 0.029]}},
                {"kind": "transform", "op": "drop_columns",
                 "params": {"columns": ["occurred_at"]}},
            ],
            "output_format": "records",
        },
    },
    {
        "id": "vitals-qc",
        "name": "Vitals quality check",
        "description": (
            "Guard physiological ranges for heart rate, blood pressure, and "
            "SpO2, then enrich with ward metadata. Clean dataset - compare "
            "against a deliberately loosened config to see gates open."
        ),
        "config": {
            "dataset_id": "vitals",
            "stages": [
                {"kind": "validator", "op": "range",
                 "params": {"field": "heart_rate", "min": 20, "max": 220}},
                {"kind": "validator", "op": "range",
                 "params": {"field": "systolic_bp", "min": 60, "max": 250}},
                {"kind": "validator", "op": "range",
                 "params": {"field": "spo2_pct", "min": 50, "max": 100}},
                {"kind": "transform", "op": "join_lookup",
                 "params": {"on": "ward", "table": "wards", "how": "left"}},
            ],
            "output_format": "csv",
        },
    },
    {
        "id": "order-quality-gate",
        "name": "Order quality gate",
        "description": (
            "Second failure demo, in retail: require order and SKU, reject impossible "
            "quantities, non-numeric prices, non-ISO countries and duplicate orders, "
            "then join the product catalog and compute line revenue."
        ),
        "config": {
            "dataset_id": "orders-faulty",
            "stages": [
                {"kind": "validator", "op": "not_null",
                 "params": {"fields": ["order_id", "sku"]}},
                {"kind": "validator", "op": "range",
                 "params": {"field": "quantity", "min": 1, "max": 100}},
                {"kind": "validator", "op": "type_check",
                 "params": {"field": "unit_price", "expected": "float"}},
                {"kind": "validator", "op": "regex",
                 "params": {"field": "country", "pattern": "[A-Z]{2}"}},
                {"kind": "validator", "op": "unique",
                 "params": {"fields": ["order_id"]}},
                {"kind": "transform", "op": "join_lookup",
                 "params": {"on": "sku", "table": "products", "how": "inner"}},
                {"kind": "transform", "op": "derive_column",
                 "params": {"target": "line_total", "fn": "multiply",
                            "args": [{"field": "quantity"}, {"field": "unit_price"}]}},
            ],
            "output_format": "records",
        },
    },
    {
        "id": "web-error-triage",
        "name": "Web error triage",
        "description": (
            "Keep only server errors (5xx) from the access logs, drop bot traffic, "
            "convert latency to seconds, and trim columns for an incident report."
        ),
        "config": {
            "dataset_id": "web-logs",
            "stages": [
                {"kind": "transform", "op": "filter",
                 "params": {"field": "status", "op": "gte", "value": 500}},
                {"kind": "transform", "op": "filter",
                 "params": {"field": "user_agent", "op": "ne", "value": "bot"}},
                {"kind": "transform", "op": "derive_column",
                 "params": {"target": "latency_s", "fn": "divide",
                            "args": [{"field": "latency_ms"}, 1000]}},
                {"kind": "transform", "op": "drop_columns",
                 "params": {"columns": ["bytes", "latency_ms"]}},
            ],
            "output_format": "csv",
        },
    },
    {
        "id": "flight-delay-report",
        "name": "Flight delay report",
        "description": (
            "Exclude cancellations, keep departures delayed by 15+ minutes, enrich "
            "with origin airport details, and express the delay in hours."
        ),
        "config": {
            "dataset_id": "flights",
            "stages": [
                {"kind": "transform", "op": "filter",
                 "params": {"field": "cancelled", "op": "eq", "value": False}},
                {"kind": "transform", "op": "filter",
                 "params": {"field": "dep_delay_min", "op": "gte", "value": 15}},
                {"kind": "transform", "op": "join_lookup",
                 "params": {"on": "origin", "table": "airports", "how": "left"}},
                {"kind": "transform", "op": "derive_column",
                 "params": {"target": "delay_h", "fn": "divide",
                            "args": [{"field": "dep_delay_min"}, 60]}},
            ],
            "output_format": "records",
        },
    },
]
