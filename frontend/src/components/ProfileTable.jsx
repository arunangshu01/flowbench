import React from "react";

const num = (v) => (typeof v === "number" ? (Number.isInteger(v) ? v : v.toFixed(2)) : "-");

/** Per-field data-quality profile computed by the engine over all rows. */
export default function ProfileTable({ profile }) {
  const fields = Object.entries(profile ?? {});
  if (!fields.length) return <div className="empty-note">No rows reached this point, so there is nothing to profile.</div>;
  return (
    <div className="table-wrap">
      <table className="data-table profile-table">
        <thead>
          <tr>
            <th scope="col">field</th><th scope="col">type</th><th scope="col">nulls</th>
            <th scope="col" className="num">distinct</th><th scope="col" className="num">min</th>
            <th scope="col" className="num">max</th>
          </tr>
        </thead>
        <tbody>
          {fields.map(([name, p]) => (
            <tr key={name}>
              <td className="mono t-accent">{name}</td>
              <td>
                <span className={`type-dot t-${p.type}`}>{p.type ?? "-"}</span>
                {p.mixed_types && <span className="badge badge-warn" title="More than one runtime type seen">mixed</span>}
              </td>
              <td>
                <span className="meter" aria-hidden="true">
                  <span className={p.nulls ? "is-warn" : ""} style={{ width: `${Math.max(p.nulls ? 4 : 0, p.null_pct)}%` }} />
                </span>
                <span className={p.nulls ? "t-warn" : "muted"}>{p.null_pct}%</span>
              </td>
              <td className="num">{p.distinct}{p.distinct_capped ? "+" : ""}</td>
              <td className="num">{num(p.min)}</td>
              <td className="num">{num(p.max)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
