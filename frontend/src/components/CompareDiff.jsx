import React from "react";
import { fmtInt, fmtMs, shortId } from "../lib/format";

function Delta({ a, b, goodWhen = "up" }) {
  if (a == null || b == null) return <span className="muted">-</span>;
  const d = b - a;
  if (d === 0) return <span className="delta">±0</span>;
  const tone = goodWhen === "none" ? "" : (goodWhen === "up" ? d > 0 : d < 0) ? "t-good" : "t-bad";
  return <span className={`delta ${tone}`}>{d > 0 ? "+" : ""}{fmtInt(d)}</span>;
}

function Side({ tag, run }) {
  return (
    <div className="cmp-side">
      <div className="cmp-side-head"><span className="cmp-tag">{tag}</span><span className="mono">{shortId(run.run_id)}</span>
        <span className="muted">{run.dataset_id}</span></div>
      <div className="cmp-metrics mono">
        <span><b>{fmtInt(run.rows_out)}</b> out</span>
        <span className="t-bad"><b>{fmtInt(run.rejected_total)}</b> rejected</span>
        <span className="t-warn"><b>{fmtInt(run.filtered_total)}</b> filtered</span>
        <span className="muted">{fmtMs(run.duration_ms)}</span>
      </div>
    </div>
  );
}

export default function CompareDiff({ diff }) {
  return (
    <div className="compare">
      <div className="cmp-sides">
        <Side tag="A" run={diff.a} />
        <div className="cmp-vs">vs</div>
        <Side tag="B" run={diff.b} />
      </div>
      <div className="cmp-flags">
        <span className={`badge ${diff.same_config ? "" : "badge-warn"}`}>
          {diff.same_config ? "identical config" : "config differs"}
        </span>
        {diff.schema.only_a.length > 0 && <span className="badge">only in A: {diff.schema.only_a.join(", ")}</span>}
        {diff.schema.only_b.length > 0 && <span className="badge">only in B: {diff.schema.only_b.join(", ")}</span>}
        <span className="muted">Δ = B - A</span>
      </div>
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col">#</th><th scope="col">A stage</th><th scope="col">B stage</th>
              <th scope="col" className="num">Δ out</th><th scope="col" className="num">Δ rejected</th>
              <th scope="col" className="num">Δ filtered</th>
            </tr>
          </thead>
          <tbody>
            {diff.stages.map((s) => (
              <React.Fragment key={s.index}>
                <tr>
                  <td className="mono muted">{s.index === 0 ? "src" : s.index}</td>
                  <td className="mono">{s.a?.op ?? <span className="t-good">+ added in B</span>}</td>
                  <td className="mono">{s.b?.op ?? <span className="t-bad">- removed in B</span>}</td>
                  <td className="num"><Delta a={s.a?.rows_out} b={s.b?.rows_out} /></td>
                  <td className="num"><Delta a={s.a?.rejected} b={s.b?.rejected} goodWhen="down" /></td>
                  <td className="num"><Delta a={s.a?.filtered} b={s.b?.filtered} goodWhen="none" /></td>
                </tr>
                {(s.errors_only_a.length > 0 || s.errors_only_b.length > 0) && (
                  <tr className="cmp-errors">
                    <td />
                    <td colSpan={5}>
                      {s.errors_only_a.length > 0 && <div><span className="cmp-tag">A</span> {s.errors_only_a.length} error kind(s) only in A, e.g. <span className="mono">{s.errors_only_a[0]}</span></div>}
                      {s.errors_only_b.length > 0 && <div><span className="cmp-tag">B</span> {s.errors_only_b.length} error kind(s) only in B, e.g. <span className="mono">{s.errors_only_b[0]}</span></div>}
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
