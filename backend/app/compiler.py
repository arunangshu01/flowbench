"""Compile a Flowbench pipeline to SQL (DuckDB dialect).

Each stage becomes one CTE that keeps the rows the engine would pass on.
Validator and filter stages become WHERE clauses; ``unique``/``dedupe`` keep
the first row per key with QUALIFY over the source order (``_rid``);
transforms use DuckDB's star modifiers (EXCLUDE / REPLACE / RENAME).

The SQL is generated for learning and portability; Flowbench itself never
executes it. Lookup tables are inlined as VALUES so the output is
self-contained apart from the dataset, which can be downloaded as CSV.
Where SQL semantics differ from the Python engine, a note is attached.
"""

from __future__ import annotations

from typing import Any

from app.core.planner import plan_pipeline
from app.datasets import LOOKUPS, get_dataset

_CAST = {"string": "VARCHAR", "integer": "BIGINT", "float": "DOUBLE", "number": "DOUBLE", "boolean": "BOOLEAN"}
_CMP = {"eq": "=", "ne": "<>", "gt": ">", "lt": "<", "gte": ">=", "lte": "<="}
_ARITH = {"add": "+", "subtract": "-", "multiply": "*"}
_SQL_TYPES = {"string": "VARCHAR", "timestamp": "VARCHAR", "integer": "BIGINT", "float": "DOUBLE", "boolean": "BOOLEAN"}


def ident(name: str) -> str:
    return '"' + name.replace('"', '""') + '"'


def lit(value: Any) -> str:
    if value is None:
        return "NULL"
    if isinstance(value, bool):
        return "TRUE" if value else "FALSE"
    if isinstance(value, (int, float)):
        return repr(value)
    return "'" + str(value).replace("'", "''") + "'"


def table_name(dataset_id: str) -> str:
    return dataset_id.replace("-", "_")


def _arg(a: Any) -> str:
    return ident(a["field"]) if isinstance(a, dict) else lit(a)


def _derive_expr(fn: str, args: list[Any]) -> str:
    a = [_arg(x) for x in args]
    if fn in _ARITH:
        return f"({a[0]} {_ARITH[fn]} {a[1]})"
    if fn == "divide":
        return f"({a[0]} / NULLIF({a[1]}, 0))"
    if fn == "concat":
        return f"concat(CAST({a[0]} AS VARCHAR), CAST({a[1]} AS VARCHAR))"
    if fn == "abs":
        return f"abs({a[0]})"
    return f"round({a[0]}, {a[1]})"


def _filter_cond(field: str, op: str, value: Any) -> str:
    col = ident(field)
    if op == "in":
        values = value if isinstance(value, list) else [value]
        return f"{col} IN ({', '.join(lit(v) for v in values)})" if values else "FALSE"
    if op == "contains":
        return f"contains({col}, {lit(str(value))})"
    if value is None:
        return f"{col} IS NULL" if op == "eq" else f"{col} IS NOT NULL" if op == "ne" else "FALSE"
    if op == "ne":  # Python keeps None != value; SQL NULL <> value is NULL
        return f"({col} <> {lit(value)} OR {col} IS NULL)"
    return f"{col} {_CMP[op]} {lit(value)}"


def _stage_sql(op: str, p: dict, prev: str, schema_in: list[str], notes: list[str], n: int) -> str:
    """SELECT for one stage reading from CTE ``prev``."""
    if op == "not_null":
        return f"SELECT * FROM {prev}\n  WHERE " + "\n    AND ".join(f"{ident(f)} IS NOT NULL" for f in p["fields"])
    if op == "type_check":
        col, t = ident(p["field"]), p["expected"]
        if t == "string":
            return f"SELECT * FROM {prev}\n  WHERE {col} IS NOT NULL AND typeof({col}) = 'VARCHAR'"
        notes.append(f"stage {n} type_check: SQL checks convertibility with TRY_CAST; text like '12.5' passes "
                     "in SQL but is rejected by the Python engine, which checks the runtime type.")
        return f"SELECT * FROM {prev}\n  WHERE TRY_CAST({col} AS {_CAST[t]}) IS NOT NULL"
    if op == "range":
        col = ident(p["field"])
        conds = []
        if p.get("min") is not None:
            conds.append(f"{col} >= {lit(p['min'])}")
        if p.get("max") is not None:
            conds.append(f"{col} <= {lit(p['max'])}")
        return f"SELECT * FROM {prev}\n  WHERE " + " AND ".join(conds)
    if op == "regex":
        return f"SELECT * FROM {prev}\n  WHERE regexp_full_match({ident(p['field'])}, {lit(p['pattern'])})"
    if op == "allowed_values":
        return f"SELECT * FROM {prev}\n  WHERE {ident(p['field'])} IN ({', '.join(lit(v) for v in p['values'])})"
    if op in ("unique", "dedupe"):
        keys = ", ".join(ident(f) for f in p["fields"])
        return f"SELECT * FROM {prev}\n  QUALIFY row_number() OVER (PARTITION BY {keys} ORDER BY _rid) = 1"
    if op == "filter":
        return f"SELECT * FROM {prev}\n  WHERE {_filter_cond(p['field'], p['op'], p['value'])}"
    if op == "rename":
        pairs = ", ".join(f"{ident(o)} AS {ident(nw)}" for o, nw in p["mapping"].items())
        return f"SELECT * RENAME ({pairs}) FROM {prev}"
    if op == "cast":
        col, t = ident(p["field"]), _CAST[p["to"]]
        return (f"SELECT * REPLACE (TRY_CAST({col} AS {t}) AS {col}) FROM {prev}\n"
                f"  WHERE {col} IS NULL OR TRY_CAST({col} AS {t}) IS NOT NULL")
    if op == "derive_column":
        expr, target = _derive_expr(p["fn"], p["args"]), p["target"]
        if p["fn"] == "concat":
            notes.append(f"stage {n} derive_column: SQL concat() treats NULL as empty text; "
                         "the Python engine renders it as 'None'.")
        if target in schema_in:
            return f"SELECT * REPLACE ({expr} AS {ident(target)}) FROM {prev}"
        return f"SELECT *, {expr} AS {ident(target)} FROM {prev}"
    if op == "drop_columns":
        cols = [c for c in p["columns"] if c in schema_in]
        return f"SELECT * EXCLUDE ({', '.join(ident(c) for c in cols)}) FROM {prev}" if cols else f"SELECT * FROM {prev}"
    if op in ("upper", "lower"):
        col = ident(p["field"])
        return f"SELECT * REPLACE ({op}({col}) AS {col}) FROM {prev}"
    if op == "join_lookup":
        table = p["table"]
        cols = list(next(iter(LOOKUPS[table].values())).keys())
        clash = [c for c in cols if c in schema_in]
        base = f"s.* EXCLUDE ({', '.join(ident(c) for c in clash)})" if clash else "s.*"
        join = "JOIN" if p.get("how", "left") == "inner" else "LEFT JOIN"
        picked = ", ".join(f"l.{ident(c)}" for c in cols)
        return (f"SELECT {base}, {picked}\n  FROM {prev} AS s\n"
                f"  {join} lookup_{table} AS l ON s.{ident(p['on'])} = l.\"key\"")
    raise ValueError(f"cannot compile op '{op}'")  # pragma: no cover - planner rejects unknown ops


def _lookup_sql(table: str) -> str:
    rows = LOOKUPS[table]
    cols = list(next(iter(rows.values())).keys())
    def cell(v: Any) -> str:  # DuckDB reads 14.9 as DECIMAL; the engine has floats
        return f"{lit(v)}::DOUBLE" if isinstance(v, float) else lit(v)

    values = ",\n    ".join(
        "(" + ", ".join([lit(k)] + [cell(v[c]) for c in cols]) + ")" for k, v in rows.items()
    )
    names = ", ".join(['"key"'] + [ident(c) for c in cols])
    return f"CREATE OR REPLACE TABLE lookup_{table} AS\n  SELECT * FROM (VALUES\n    {values}\n  ) AS t({names});"


def compile_sql(dataset_id: str, stages: list[dict]) -> dict:
    """Return {"valid", "dialect", "sql", "setup_sql", "notes", "plan"}."""
    plan = plan_pipeline(dataset_id, stages)
    if not plan["valid"]:
        return {"valid": False, "dialect": "duckdb", "sql": "", "setup_sql": "", "notes": [], "plan": plan}

    dataset = get_dataset(dataset_id)
    table = table_name(dataset_id)
    notes: list[str] = []
    # rowid is the insertion position, i.e. the source order the engine uses
    ctes = [f"source AS (\n  SELECT rowid AS _rid, *\n  FROM {table}\n)"]
    prev = "source"
    schema = [f["name"] for f in plan["input_schema"]]
    for i, st in enumerate(stages):
        name = f"s{i + 1}_{st['op']}"
        body = _stage_sql(st["op"], st.get("params") or {}, prev, schema, notes, i + 1)
        ctes.append(f"-- stage {i + 1}: {st['kind']} {st['op']}\n{name} AS (\n  {body}\n)")
        prev = name
        schema = [f["name"] for f in plan["stages"][i]["schema"]]

    header = (f"-- Flowbench pipeline compiled to SQL (DuckDB dialect).\n"
              f"-- Dataset: {dataset_id} ({dataset.row_count} rows). Generated by Flowbench, not executed by it.\n")
    sql = header + "WITH " + ",\n".join(ctes) + f"\nSELECT * EXCLUDE (_rid)\nFROM {prev}\nORDER BY _rid;\n"

    lookups = sorted({st["params"]["table"] for st in stages if st["op"] == "join_lookup"})
    cols = ",\n  ".join(f"{ident(f.name)} {_SQL_TYPES[f.type]}" for f in dataset.schema)
    setup = [
        f"-- Load the dataset (download {dataset_id}.csv from Flowbench).",
        f"CREATE OR REPLACE TABLE {table} (\n  {cols}\n);",
        f"COPY {table} FROM '{dataset_id}.csv' (HEADER, NULLSTR '');",
    ] + [_lookup_sql(t) for t in lookups]
    if dataset_id.endswith("-faulty"):
        notes.append("This dataset has injected type errors; with a typed table, COPY rejects those rows "
                     "before any stage runs. Load affected columns as VARCHAR to reproduce the engine.")
    return {"valid": True, "dialect": "duckdb", "sql": sql, "setup_sql": "\n\n".join(setup) + "\n",
            "notes": notes, "plan": plan}
