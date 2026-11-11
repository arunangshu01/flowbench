import React, { useEffect, useState } from "react";
import Icon from "./Icon";
import CompareDiff from "./CompareDiff";
import { api } from "../api/client";
import { fmtInt, fmtMs, relTime, shortId } from "../lib/format";

const VIA = { manual: ["play", "manual"], replay: ["replay", "replay"], schedule: ["clock", "schedule"] };

export default function HistoryView({ runs, now, busy, activeRunId, onOpen, onReplay, onError }) {
  const [picked, setPicked] = useState([]);
  const [diff, setDiff] = useState(null);

  useEffect(() => {
    setDiff(null);
    if (picked.length === 2) api.compare(picked[0], picked[1]).then(setDiff).catch(onError);
  }, [picked, onError]);

  const toggle = (id) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id].slice(-2)));

  return (
    <div className="view">
      <section className="panel">
        <header className="panel-head">
          <div>
            <span className="kicker">run history</span>
            <h2>Every run is stored with its config and full per-stage report</h2>
          </div>
          <span className="muted mono">{runs.length} runs</span>
        </header>
        <p className="panel-note">Select two runs to compare them. Open loads a run's report and config into the workbench.</p>

        {runs.length === 0 ? <div className="empty-note">No runs yet.</div> : (
          <div className="table-wrap is-tall">
            <table className="data-table history-table">
              <thead>
                <tr>
                  <th scope="col" className="col-check"><span className="sr-only">compare</span></th>
                  <th scope="col">run</th><th scope="col">dataset</th><th scope="col">via</th>
                  <th scope="col">yield</th><th scope="col" className="num">rejected</th>
                  <th scope="col" className="num">time</th><th scope="col">when</th><th scope="col" />
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => {
                  const [icon, label] = VIA[r.trigger] ?? ["play", r.trigger ?? "-"];
                  const pct = r.rows_in ? (100 * r.rows_out) / r.rows_in : 0;
                  const sel = picked.indexOf(r.id);
                  return (
                    <tr key={r.id} className={`${sel >= 0 ? "is-picked" : ""} ${r.id === activeRunId ? "is-active" : ""}`}>
                      <td className="col-check">
                        <button type="button" className={`pick ${sel >= 0 ? "is-on" : ""}`} onClick={() => toggle(r.id)}
                          aria-pressed={sel >= 0} aria-label={`Select run ${shortId(r.id)} for comparison`}>
                          {sel >= 0 ? "AB"[sel] : ""}
                        </button>
                      </td>
                      <td className="mono">
                        {shortId(r.id)}
                        {r.replayed_from && <span className="muted"> ↻{shortId(r.replayed_from).slice(0, 4)}</span>}
                      </td>
                      <td>{r.dataset_id}<span className="muted mono"> · {r.stage_count ?? "?"} st</span></td>
                      <td><span className="via"><Icon name={icon} size={12} /> {label}</span></td>
                      <td>
                        <span className="mini-bar" aria-hidden="true"><span style={{ width: `${pct}%` }} /></span>
                        <span className="mono">{fmtInt(r.rows_out)}/{fmtInt(r.rows_in)}</span>
                      </td>
                      <td className={`num mono ${r.rejected_total ? "t-bad" : "muted"}`}>{fmtInt(r.rejected_total)}</td>
                      <td className="num mono muted">{fmtMs(r.duration_ms)}</td>
                      <td className="muted" title={new Date(r.created_at).toLocaleString()}>{relTime(r.created_at, now)}</td>
                      <td>
                        <div className="row-actions">
                          <button type="button" className="icon-btn" title="Open in workbench"
                            aria-label={`Open run ${shortId(r.id)}`} onClick={() => onOpen(r.id)}>
                            <Icon name="open" size={14} />
                          </button>
                          <button type="button" className="icon-btn" title="Replay stored config" disabled={busy}
                            aria-label={`Replay run ${shortId(r.id)}`} onClick={() => onReplay(r.id)}>
                            <Icon name="replay" size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="panel">
        <header className="panel-head">
          <div>
            <span className="kicker">compare</span>
            <h2>{picked.length === 2 ? `A ${shortId(picked[0])} vs B ${shortId(picked[1])}` : "Pick two runs above"}</h2>
          </div>
          {picked.length > 0 && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPicked([])}>Clear</button>}
        </header>
        {diff ? <CompareDiff diff={diff} /> : (
          <p className="panel-note">
            Typical flow: run the faulty-sensor demo, loosen or tighten a rule, use <b>Replay with edits</b>, then compare the two runs here.
          </p>
        )}
      </section>
    </div>
  );
}
