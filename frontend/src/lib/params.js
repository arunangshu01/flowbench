// Helpers for the typed stage-param editors.

export const NUMERIC = new Set(["integer", "float", "number"]);

const byType = (schema, pred) => schema.filter((f) => pred(f.type)).map((f) => f.name);

// Lookup table each join key most plausibly targets.
const JOIN_HINTS = {
  device_id: "devices", merchant: "merchants", ward: "wards", sku: "products",
  carrier: "carriers", station_id: "stations", origin: "airports", destination: "airports",
};

/**
 * Sensible starting params for an op given the schema flowing into it,
 * so a freshly added stage is runnable (or close to it) immediately.
 */
export function defaultParams(op, schema) {
  const all = schema.map((f) => f.name);
  const numeric = byType(schema, (t) => NUMERIC.has(t));
  const strings = byType(schema, (t) => t === "string");
  const firstNum = numeric[0] ?? all[0];
  const firstStr = strings[0] ?? all[0];
  const first = all[0];

  switch (op.name) {
    case "not_null":
    case "unique":
    case "dedupe":
      return { fields: first ? [first] : [] };
    case "type_check":
      return { field: firstNum, expected: "float" };
    case "range":
      return { field: firstNum, min: 0 };
    case "regex":
      return { field: firstStr, pattern: ".+" };
    case "allowed_values":
      return { field: firstStr, values: [] };
    case "rename":
      return first ? { mapping: { [first]: `${first}_renamed` } } : { mapping: {} };
    case "cast":
      return { field: firstNum, to: "string" };
    case "filter":
      return numeric.length
        ? { field: firstNum, op: "gte", value: 0 }
        : { field: firstStr, op: "eq", value: "" };
    case "derive_column":
      return { target: "derived", fn: "multiply", args: [{ field: firstNum }, 2] };
    case "drop_columns":
      return { columns: all.length ? [all[all.length - 1]] : [] };
    case "upper":
    case "lower":
      return { field: firstStr };
    case "join_lookup": {
      const key = all.find((f) => JOIN_HINTS[f]);
      return { on: key ?? first, table: key ? JOIN_HINTS[key] : op.params.find((p) => p.name === "table")?.options?.[0], how: "left" };
    }
    default: {
      const out = {};
      for (const p of op.params) {
        if (p.default !== undefined) out[p.name] = p.default;
        else if (p.type === "enum" && p.required) out[p.name] = p.options?.[0];
      }
      return out;
    }
  }
}

/** Parse free text typed into a "value" editor into a JSON scalar. */
export function parseScalar(text) {
  const t = text.trim();
  if (t === "") return "";
  if (t === "true") return true;
  if (t === "false") return false;
  if (t === "null") return null;
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  return text;
}

export const scalarType = (v) =>
  v === null ? "null" : Array.isArray(v) ? "list" : typeof v === "number" ? "number" : typeof v;

export function displayScalar(v) {
  if (v === undefined) return "";
  if (v === null) return "null";
  return String(v);
}

/** Resize derive_column args to an fn's arity, keeping what fits. */
export function fitArgs(args, arity, schema) {
  const numeric = schema.filter((f) => NUMERIC.has(f.type)).map((f) => f.name);
  const next = (args ?? []).slice(0, arity);
  while (next.length < arity) next.push(next.length === 0 ? { field: numeric[0] ?? schema[0]?.name } : 1);
  return next;
}
