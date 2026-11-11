"""Static pipeline planner.

Walks the stage list without touching data, propagating the schema through
each op. It reports per-stage issues:

* ``error``   the pipeline cannot run as configured (bad params, a field
              that does not exist at that point in the pipeline).
* ``warning`` it will run, but probably not as intended (e.g. ``range`` on a
              string field rejects every row).

Runs are refused when any error is present; the UI calls ``/api/validate``
while the user edits so problems show up inline before execution.
"""

from __future__ import annotations

from typing import Any

from app.datasets import LOOKUPS, get_dataset
from app.registry import field_refs, get_op, validate_params

NUMERIC = {"integer", "float", "number"}
_NUMERIC_FNS = {"add", "subtract", "multiply", "divide", "abs", "round"}


def _py_type(value: Any) -> str:
    if isinstance(value, bool):
        return "boolean"
    if isinstance(value, int):
        return "integer"
    if isinstance(value, float):
        return "float"
    return "string"


def _lookup_schema(table: str) -> dict[str, str]:
    rows = LOOKUPS.get(table, {})
    first = next(iter(rows.values()), {})
    return {k: _py_type(v) for k, v in first.items()}


def _apply(op: str, params: dict, schema: dict[str, str],
           warn: list[str]) -> dict[str, str]:
    """Return the schema after ``op``; append warnings for suspicious use."""
    out = dict(schema)
    if op == "range" and schema.get(params["field"]) not in NUMERIC:
        warn.append(f"'{params['field']}' is {schema.get(params['field'])}; every row will be rejected")
    elif op == "type_check":
        declared = schema.get(params["field"])
        expected = params["expected"]
        compatible = declared == expected or (expected in ("float", "number") and declared in NUMERIC)
        if not compatible:
            warn.append(f"'{params['field']}' is declared {declared}, checking for {expected}")
    elif op in ("upper", "lower", "regex") and schema.get(params["field"]) != "string":
        warn.append(f"'{params['field']}' is {schema.get(params['field'])}, not string")
    elif op == "rename":
        mapping = params["mapping"]
        for old, new in mapping.items():
            if new in out and new != old and new not in mapping:
                warn.append(f"renaming '{old}' overwrites existing '{new}'")
        targets = {mapping[k] for k in out if k in mapping}
        out = {mapping.get(k, k): t for k, t in out.items() if k in mapping or k not in targets}
    elif op == "cast":
        out[params["field"]] = params["to"]
    elif op == "derive_column":
        fn, target = params["fn"], params["target"]
        if target in out:
            warn.append(f"'{target}' already exists and will be overwritten")
        if fn in _NUMERIC_FNS:
            for a in params["args"]:
                if isinstance(a, dict) and schema.get(a["field"]) not in NUMERIC:
                    warn.append(f"'{a['field']}' is {schema.get(a['field'])}; {fn} needs numbers")
                elif isinstance(a, str):
                    warn.append(f"literal {a!r} is a string; {fn} needs numbers")
        out[target] = "string" if fn == "concat" else "float"
    elif op == "drop_columns":
        for c in params["columns"]:
            if c not in out:
                warn.append(f"'{c}' does not exist; nothing to drop")
            out.pop(c, None)
        if not out:
            warn.append("all columns dropped; output rows will be empty")
    elif op == "join_lookup":
        for col, t in _lookup_schema(params["table"]).items():
            if col in out:
                warn.append(f"lookup column '{col}' overwrites an existing field")
            out[col] = t
    return out


def _schema_list(schema: dict[str, str]) -> list[dict]:
    return [{"name": k, "type": v} for k, v in schema.items()]


def plan_pipeline(dataset_id: str, stages: list[dict]) -> dict:
    """Plan a pipeline. ``stages`` are dicts with kind/op/params."""
    dataset = get_dataset(dataset_id)
    if dataset is None:
        return {"valid": False, "dataset_error": f"unknown dataset '{dataset_id}'",
                "input_schema": [], "output_schema": [], "stages": []}

    schema = {f.name: f.type for f in dataset.schema}
    input_schema = _schema_list(schema)
    planned: list[dict] = []
    valid = True

    for i, st in enumerate(stages):
        kind, op, params = st["kind"], st["op"], st.get("params") or {}
        errors: list[str] = []
        warnings: list[str] = []
        spec = get_op(kind, op)
        if spec is None:
            errors.append(f"unknown {kind} op '{op}'")
        else:
            errors.extend(validate_params(spec, params))
            if not errors:
                missing = [f for f in dict.fromkeys(field_refs(spec, params)) if f not in schema]
                errors.extend(f"field '{f}' does not exist at this stage" for f in missing)
            if not errors:
                schema = _apply(op, params, schema, warnings)

        issues = ([{"level": "error", "message": m} for m in errors]
                  + [{"level": "warning", "message": m} for m in warnings])
        valid = valid and not errors
        planned.append({"index": i, "kind": kind, "op": op, "issues": issues,
                        "schema": _schema_list(schema)})

    return {"valid": valid, "input_schema": input_schema,
            "output_schema": _schema_list(schema), "stages": planned}
