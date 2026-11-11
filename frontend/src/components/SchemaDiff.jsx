import React from "react";

/** Side-by-side schema: what flows in vs. what flows out. */
export default function SchemaDiff({ before = [], after = [], beforeLabel = "in", afterLabel = "out" }) {
  const inMap = Object.fromEntries(before.map((f) => [f.name, f.type]));
  const outMap = Object.fromEntries(after.map((f) => [f.name, f.type]));
  const removed = before.filter((f) => !(f.name in outMap));
  const added = after.filter((f) => !(f.name in inMap));
  const retyped = after.filter((f) => f.name in inMap && inMap[f.name] !== f.type);

  const row = (f, state) => (
    <li key={f.name} className={`schema-row is-${state}`}>
      <span className="mono">{f.name}</span>
      <span className={`type-dot t-${f.type}`}>{f.type}</span>
    </li>
  );

  return (
    <div className="schema-diff">
      <div className="schema-col">
        <h4>{beforeLabel} <span className="muted">{before.length}</span></h4>
        <ul>{before.map((f) => row(f, f.name in outMap ? "same" : "removed"))}</ul>
      </div>
      <div className="schema-col">
        <h4>{afterLabel} <span className="muted">{after.length}</span></h4>
        <ul>
          {after.map((f) => row(f, !(f.name in inMap) ? "added" : inMap[f.name] !== f.type ? "retyped" : "same"))}
        </ul>
      </div>
      <div className="schema-legend">
        {added.length > 0 && <span className="t-good">+ {added.map((f) => f.name).join(", ")}</span>}
        {removed.length > 0 && <span className="t-bad">- {removed.map((f) => f.name).join(", ")}</span>}
        {retyped.length > 0 && <span className="t-warn">~ {retyped.map((f) => `${f.name}: ${inMap[f.name]}→${f.type}`).join(", ")}</span>}
        {!added.length && !removed.length && !retyped.length && <span className="muted">schema unchanged</span>}
      </div>
    </div>
  );
}
