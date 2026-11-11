"""Registry of predefined validators and transforms.

Every pipeline operation is a whitelisted entry here. Config JSON selects an
op by name and supplies params; there is no arbitrary code execution.

Each op declares structured ``ParamSpec``s. They drive three things:
server-side param validation (before any row is processed), the planner's
field-reference checks, and the typed editors rendered by the frontend.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any, Callable

from app.datasets import LOOKUPS

MAX_PATTERN_LEN = 200
MAX_MATCH_LEN = 256
MAX_LIST_LEN = 50
MAX_STRING_LEN = 200

# Heuristic ReDoS guard: reject a quantified group that itself contains a
# quantifier, e.g. (a+)+ or (\w*)*. Combined with the pattern/input length
# caps this keeps public-demo regexes linear in practice.
_NESTED_QUANTIFIER = re.compile(r"\([^)]*[+*][^)]*\)\s*[+*{]")

# ---------------------------------------------------------------------------
# Validators: (row) -> error message or None. Rejected rows do not continue.
# ---------------------------------------------------------------------------

_PY_TYPES = {
    "string": str,
    "integer": int,
    "float": (int, float),
    "boolean": bool,
    "number": (int, float),
}


def _is_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def validate_not_null(row: dict, fields: list[str], **_: Any) -> str | None:
    missing = [f for f in fields if row.get(f) is None]
    return f"null value in field(s): {', '.join(missing)}" if missing else None


def validate_type_check(row: dict, field: str, expected: str, **_: Any) -> str | None:
    value = row.get(field)
    if value is None:
        return f"field '{field}' is null"
    # bool is a subclass of int; exclude it when checking numeric types
    if expected in ("integer", "float", "number") and isinstance(value, bool):
        return f"field '{field}' has type bool, expected {expected}"
    if not isinstance(value, _PY_TYPES[expected]):
        return f"field '{field}' has type {type(value).__name__}, expected {expected}"
    return None


def validate_range(row: dict, field: str, min: float | None = None,
                   max: float | None = None, **_: Any) -> str | None:
    value = row.get(field)
    if not _is_number(value):
        return f"field '{field}' is not numeric (value={value!r})"
    if min is not None and value < min:
        return f"field '{field}'={value} below minimum {min}"
    if max is not None and value > max:
        return f"field '{field}'={value} above maximum {max}"
    return None


def validate_regex(row: dict, field: str, pattern: str, **_: Any) -> str | None:
    value = row.get(field)
    if not isinstance(value, str):
        return f"field '{field}' is not a string (value={value!r})"
    if len(value) > MAX_MATCH_LEN:
        return f"field '{field}' longer than {MAX_MATCH_LEN} chars"
    if not re.fullmatch(pattern, value):
        return f"field '{field}'={value!r} does not match /{pattern}/"
    return None


def validate_allowed_values(row: dict, field: str, values: list[Any], **_: Any) -> str | None:
    value = row.get(field)
    if value not in values:
        return f"field '{field}'={value!r} not in allowed values {values}"
    return None


# ---------------------------------------------------------------------------
# Transforms: (row) -> row, or None to drop the row (counted as filtered).
# ``unique`` and ``dedupe`` are stateful and handled by the engine.
# ---------------------------------------------------------------------------


def transform_rename(row: dict, mapping: dict[str, str], **_: Any) -> dict:
    out = dict(row)
    for old, new in mapping.items():
        if old in out:
            out[new] = out.pop(old)
    return out


def transform_cast(row: dict, field: str, to: str, **_: Any) -> dict:
    out = dict(row)
    value = out.get(field)
    if value is None:
        return out
    if to == "string":
        out[field] = str(value)
    elif to == "integer":
        out[field] = int(float(value)) if isinstance(value, str) else int(value)
    elif to == "float":
        out[field] = float(value)
    elif to == "boolean":
        out[field] = value.strip().lower() in ("true", "1", "yes") if isinstance(value, str) else bool(value)
    return out


_FILTER_OPS: dict[str, Callable[[Any, Any], bool]] = {
    "eq": lambda a, b: a == b,
    "ne": lambda a, b: a != b,
    "gt": lambda a, b: a > b,
    "lt": lambda a, b: a < b,
    "gte": lambda a, b: a >= b,
    "lte": lambda a, b: a <= b,
    "in": lambda a, b: a in b,
    "contains": lambda a, b: isinstance(a, str) and str(b) in a,
}


def transform_filter(row: dict, field: str, op: str, value: Any, **_: Any) -> dict | None:
    try:
        keep = _FILTER_OPS[op](row.get(field), value)
    except TypeError:
        keep = False
    return row if keep else None


_EXPR_FNS: dict[str, tuple[int, Callable[..., Any]]] = {
    # name -> (arity, fn)
    "add": (2, lambda a, b: a + b),
    "subtract": (2, lambda a, b: a - b),
    "multiply": (2, lambda a, b: a * b),
    "divide": (2, lambda a, b: a / b if b else None),
    "concat": (2, lambda a, b: f"{a}{b}"),
    "abs": (1, lambda a: abs(a)),
    "round": (2, lambda a, digits: round(a, int(digits))),
}


def _resolve_arg(row: dict, arg: Any) -> Any:
    """An arg is either {"field": name} or a literal."""
    if isinstance(arg, dict) and "field" in arg:
        return row.get(arg["field"])
    return arg


def transform_derive_column(row: dict, target: str, fn: str,
                            args: list[Any], **_: Any) -> dict:
    out = dict(row)
    resolved = [_resolve_arg(row, a) for a in args]
    try:
        out[target] = _EXPR_FNS[fn][1](*resolved)
    except (TypeError, ValueError, ZeroDivisionError):
        out[target] = None
    return out


def transform_drop_columns(row: dict, columns: list[str], **_: Any) -> dict:
    return {k: v for k, v in row.items() if k not in columns}


def transform_upper(row: dict, field: str, **_: Any) -> dict:
    out = dict(row)
    if isinstance(out.get(field), str):
        out[field] = out[field].upper()
    return out


def transform_lower(row: dict, field: str, **_: Any) -> dict:
    out = dict(row)
    if isinstance(out.get(field), str):
        out[field] = out[field].lower()
    return out


def lookup_fields(table: str) -> list[str]:
    t = LOOKUPS.get(table, {})
    return list(next(iter(t.values())).keys()) if t else []


def transform_join_lookup(row: dict, on: str, table: str,
                          how: str = "left", **_: Any) -> dict | None:
    match = LOOKUPS[table].get(row.get(on))
    if match is None:
        if how == "inner":
            return None  # filtered, not rejected
        return {**row, **{col: None for col in lookup_fields(table)}}
    return {**row, **match}


# ---------------------------------------------------------------------------
# Param specs
# ---------------------------------------------------------------------------

# Param types understood by validation, the planner and the UI:
#   field     one existing field name          fields   list of field names
#   string    free text                        number   int/float
#   enum      one of ``options``               value    any JSON scalar
#   values    list of JSON scalars             mapping  {old_field: new_name}
#   args      expression args: {"field": f} or number/string literals


@dataclass(frozen=True)
class ParamSpec:
    name: str
    type: str
    required: bool = True
    options: tuple[str, ...] = ()
    default: Any = None
    description: str = ""

    def describe(self) -> dict:
        d = {"name": self.name, "type": self.type, "required": self.required,
             "description": self.description}
        if self.options:
            d["options"] = list(self.options)
        if self.default is not None:
            d["default"] = self.default
        return d


@dataclass(frozen=True)
class OpSpec:
    name: str
    kind: str  # "validator" | "transform"
    fn: Callable | None
    params: tuple[ParamSpec, ...]
    description: str
    category: str = ""
    extra_check: Callable[[dict], str | None] | None = field(default=None, compare=False)

    def describe(self) -> dict:
        return {"name": self.name, "kind": self.kind, "category": self.category,
                "description": self.description,
                "params": [p.describe() for p in self.params]}


_TYPES = ("string", "integer", "float", "boolean", "number")
_CASTS = ("string", "integer", "float", "boolean")


def _range_check(params: dict) -> str | None:
    lo, hi = params.get("min"), params.get("max")
    if lo is None and hi is None:
        return "range needs at least one of min/max"
    if lo is not None and hi is not None and lo > hi:
        return f"min ({lo}) is greater than max ({hi})"
    return None


def _regex_check(params: dict) -> str | None:
    pattern = params.get("pattern", "")
    if len(pattern) > MAX_PATTERN_LEN:
        return f"pattern longer than {MAX_PATTERN_LEN} chars"
    if _NESTED_QUANTIFIER.search(pattern):
        return "nested quantifiers like (a+)+ are not allowed"
    try:
        re.compile(pattern)
    except re.error as exc:
        return f"invalid regex: {exc}"
    return None


def _derive_check(params: dict) -> str | None:
    fn, args = params.get("fn"), params.get("args", [])
    arity = _EXPR_FNS[fn][0]
    if len(args) != arity:
        return f"{fn} takes {arity} argument(s), got {len(args)}"
    return None


def _p(name: str, type_: str, required: bool = True, options: tuple = (),
       default: Any = None, description: str = "") -> ParamSpec:
    return ParamSpec(name, type_, required, tuple(options), default, description)


VALIDATORS: dict[str, OpSpec] = {o.name: o for o in (
    OpSpec("not_null", "validator", validate_not_null,
           (_p("fields", "fields", description="Fields that must be present and non-null"),),
           "Reject rows where any listed field is null or missing.", "completeness"),
    OpSpec("type_check", "validator", validate_type_check,
           (_p("field", "field"), _p("expected", "enum", options=_TYPES)),
           "Reject rows where the field has the wrong runtime type.", "conformity"),
    OpSpec("range", "validator", validate_range,
           (_p("field", "field"),
            _p("min", "number", required=False, description="Inclusive lower bound"),
            _p("max", "number", required=False, description="Inclusive upper bound")),
           "Reject rows where a numeric field is outside [min, max].", "accuracy",
           _range_check),
    OpSpec("regex", "validator", validate_regex,
           (_p("field", "field"),
            _p("pattern", "string", description="Full-match regular expression")),
           "Reject rows where a string field does not fully match the pattern.", "conformity",
           _regex_check),
    OpSpec("allowed_values", "validator", validate_allowed_values,
           (_p("field", "field"), _p("values", "values")),
           "Reject rows where the field value is not in the allowed set.", "conformity"),
    OpSpec("unique", "validator", None,
           (_p("fields", "fields", description="Key fields"),),
           "Reject rows whose key was already seen earlier in the stream.", "uniqueness"),
)}

TRANSFORMS: dict[str, OpSpec] = {o.name: o for o in (
    OpSpec("rename", "transform", transform_rename,
           (_p("mapping", "mapping", description="old field -> new name"),),
           "Rename fields according to an old -> new mapping.", "shape"),
    OpSpec("cast", "transform", transform_cast,
           (_p("field", "field"), _p("to", "enum", options=_CASTS)),
           "Convert a field to another type; values that cannot convert are rejected.", "shape"),
    OpSpec("filter", "transform", transform_filter,
           (_p("field", "field"),
            _p("op", "enum", options=tuple(_FILTER_OPS)),
            _p("value", "value", description="Comparison value (list for 'in')")),
           "Keep only rows matching the condition. Dropped rows count as filtered.", "row"),
    OpSpec("derive_column", "transform", transform_derive_column,
           (_p("target", "string", description="New column name"),
            _p("fn", "enum", options=tuple(_EXPR_FNS)),
            _p("args", "args", description="Field references or literals")),
           "Compute a new column from a fixed expression set.", "shape",
           _derive_check),
    OpSpec("drop_columns", "transform", transform_drop_columns,
           (_p("columns", "fields"),),
           "Remove the listed fields from every row.", "shape"),
    OpSpec("upper", "transform", transform_upper,
           (_p("field", "field"),), "Upper-case a string field.", "clean"),
    OpSpec("lower", "transform", transform_lower,
           (_p("field", "field"),), "Lower-case a string field.", "clean"),
    OpSpec("dedupe", "transform", None,
           (_p("fields", "fields", description="Key fields"),),
           "Keep the first row per key; later duplicates are filtered.", "row"),
    OpSpec("join_lookup", "transform", transform_join_lookup,
           (_p("on", "field", description="Join key in the stream"),
            _p("table", "enum", options=tuple(LOOKUPS)),
            _p("how", "enum", required=False, options=("left", "inner"), default="left")),
           "Enrich rows from a static dimension table keyed on a field.", "enrich"),
)}


def get_op(kind: str, name: str) -> OpSpec | None:
    return (VALIDATORS if kind == "validator" else TRANSFORMS).get(name)


def describe_registry() -> dict:
    return {"validators": [o.describe() for o in VALIDATORS.values()],
            "transforms": [o.describe() for o in TRANSFORMS.values()],
            "fn_arity": {name: arity for name, (arity, _) in _EXPR_FNS.items()}}


# ---------------------------------------------------------------------------
# Param validation (structural; field existence is the planner's job)
# ---------------------------------------------------------------------------


def _scalar(v: Any) -> bool:
    return v is None or isinstance(v, (str, int, float, bool))


def _short_str(v: Any) -> bool:
    return isinstance(v, str) and 0 < len(v) <= MAX_STRING_LEN


def _check_type(p: ParamSpec, v: Any) -> str | None:
    t = p.type
    if t in ("field", "string"):
        return None if _short_str(v) else "must be a non-empty string"
    if t == "fields":
        if not isinstance(v, list) or not v or len(v) > MAX_LIST_LEN:
            return f"must be a list of 1-{MAX_LIST_LEN} field names"
        return None if all(_short_str(x) for x in v) else "must contain only field names"
    if t == "number":
        return None if _is_number(v) else "must be a number"
    if t == "enum":
        return None if v in p.options else f"must be one of {list(p.options)}"
    if t == "value":
        if isinstance(v, list):
            return None if len(v) <= MAX_LIST_LEN and all(_scalar(x) for x in v) else "invalid list value"
        return None if _scalar(v) else "must be a scalar or list of scalars"
    if t == "values":
        if not isinstance(v, list) or not v or len(v) > MAX_LIST_LEN:
            return f"must be a list of 1-{MAX_LIST_LEN} values"
        return None if all(_scalar(x) for x in v) else "must contain only scalars"
    if t == "mapping":
        if not isinstance(v, dict) or not v or len(v) > MAX_LIST_LEN:
            return "must be a non-empty object of old -> new names"
        ok = all(_short_str(k) and _short_str(x) for k, x in v.items())
        return None if ok else "keys and values must be field names"
    if t == "args":
        if not isinstance(v, list) or len(v) > 4:
            return "must be a list of up to 4 args"
        for a in v:
            if isinstance(a, dict):
                if set(a) != {"field"} or not _short_str(a["field"]):
                    return 'field args must look like {"field": "name"}'
            elif not (_is_number(a) or isinstance(a, str)):
                return "literal args must be numbers or strings"
        return None
    return f"unknown param type {t}"


def validate_params(spec: OpSpec, params: dict) -> list[str]:
    """Return human-readable problems with ``params`` for ``spec``."""
    errors: list[str] = []
    known = {p.name for p in spec.params}
    for extra in sorted(set(params) - known):
        errors.append(f"unknown param '{extra}'")
    for p in spec.params:
        if p.name not in params or params[p.name] is None:
            if p.required:
                errors.append(f"missing required param '{p.name}'")
            continue
        problem = _check_type(p, params[p.name])
        if problem:
            errors.append(f"'{p.name}' {problem}")
    if not errors and spec.extra_check:
        problem = spec.extra_check(params)
        if problem:
            errors.append(problem)
    return errors


def field_refs(spec: OpSpec, params: dict) -> list[str]:
    """Field names an op reads from the incoming row."""
    refs: list[str] = []
    for p in spec.params:
        v = params.get(p.name)
        if v is None:
            continue
        if p.type == "field":
            refs.append(v)
        elif p.type == "fields" and spec.name != "drop_columns":
            refs.extend(v)
        elif p.type == "mapping":
            refs.extend(v.keys())
        elif p.type == "args":
            refs.extend(a["field"] for a in v if isinstance(a, dict))
    return refs
