import React from "react";

const PY_TYPE = { string: "string", number: "number", boolean: "boolean" };

// Does a JSON value conform to a declared schema type?
function conforms(value, type) {
  if (value === null || value === undefined || !type) return true;
  const t = typeof value;
  if (type === "integer") return t === "number" && Number.isInteger(value);
  if (type === "float" || type === "number") return t === "number";
  if (type === "timestamp") return t === "string";
  return PY_TYPE[t] === type;
}

/**
 * Records as a table. Columns = union of keys. The lineage id (_rid) gets its
 * own leading column; values that do not match the declared schema type are
 * flagged so faulty data is visible at a glance.
 */
export default function RecordTable({ rows, schema, emptyText = "No records", onRid, activeRid, compact }) {
  if (!rows || rows.length === 0) return <div className="empty-note">{emptyText}</div>;
  const types = Object.fromEntries((schema ?? []).map((f) => [f.name, f.type]));
  const cols = [];
  const hasRid = rows.some((r) => r._rid !== undefined);
  for (const r of rows) {
    for (const k of Object.keys(r)) if (k !== "_rid" && !cols.includes(k)) cols.push(k);
  }
  return (
    <div className={`table-wrap ${compact ? "is-compact" : ""}`}>
      <table className="data-table">
        <thead>
          <tr>
            {hasRid && <th className="col-rid" scope="col" title="Lineage id">rid</th>}
            {cols.map((c) => (
              <th key={c} scope="col">
                <span>{c}</span>
                {types[c] && <span className="th-type">{types[c]}</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r._rid ?? i} className={activeRid !== undefined && r._rid === activeRid ? "is-traced" : ""}>
              {hasRid && (
                <td className="col-rid">
                  {r._rid !== undefined && (onRid
                    ? <button type="button" className="rid-btn" onClick={() => onRid(r._rid)}
                        title="Trace this record through the pipeline">{r._rid}</button>
                    : <span className="rid-btn is-static">{r._rid}</span>)}
                </td>
              )}
              {cols.map((c) => {
                const v = r[c];
                const bad = !conforms(v, types[c]);
                return (
                  <td key={c} className={bad ? "cell-mismatch" : ""}
                    title={bad ? `expected ${types[c]}, got ${typeof v}` : undefined}>
                    {v === null || v === undefined
                      ? <span className="cell-null">null</span>
                      : typeof v === "object" ? JSON.stringify(v) : String(v)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
