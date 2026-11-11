// One-line, human-readable summaries of a stage's params (collapsed cards,
// DAG tooltips, history).

const list = (v) => (Array.isArray(v) ? v.join(", ") : "…");
const arg = (a) => (a && typeof a === "object" ? a.field : JSON.stringify(a));

export function summarizeStage({ op, params = {} }) {
  const p = params;
  switch (op) {
    case "not_null": return `${list(p.fields)} not null`;
    case "type_check": return `${p.field ?? "…"} is ${p.expected ?? "…"}`;
    case "range": return `${p.field ?? "…"} in [${p.min ?? "-∞"}, ${p.max ?? "∞"}]`;
    case "regex": return `${p.field ?? "…"} ~ /${p.pattern ?? ""}/`;
    case "allowed_values": return `${p.field ?? "…"} ∈ {${(p.values ?? []).join(", ")}}`;
    case "unique": return `unique key (${list(p.fields)})`;
    case "dedupe": return `dedupe on (${list(p.fields)})`;
    case "rename": return Object.entries(p.mapping ?? {}).map(([a, b]) => `${a} → ${b}`).join(", ") || "…";
    case "cast": return `${p.field ?? "…"} → ${p.to ?? "…"}`;
    case "filter": return `${p.field ?? "…"} ${p.op ?? "?"} ${JSON.stringify(p.value ?? "")}`;
    case "derive_column": return `${p.target ?? "…"} = ${p.fn ?? "?"}(${(p.args ?? []).map(arg).join(", ")})`;
    case "drop_columns": return `drop ${list(p.columns)}`;
    case "upper": return `upper(${p.field ?? "…"})`;
    case "lower": return `lower(${p.field ?? "…"})`;
    case "join_lookup": return `${p.how ?? "left"} join ${p.table ?? "…"} on ${p.on ?? "…"}`;
    default: return "";
  }
}
