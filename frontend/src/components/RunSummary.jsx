import React from "react";
import Icon from "./Icon";
import { api } from "../api/client";
import { fmtInt, fmtMs, shortId } from "../lib/format";

const TRIGGER = { manual: "manual run", replay: "replay", schedule: "scheduled" };

export default function RunSummary({ report, stale, busy, onReplayStored, onReplayCurrent, onLoadParent }) {
  const pct = report.rows_in ? (100 * report.rows_out) / report.rows_in : 0;
  const rej = report.rows_in ? (100 * report.rejected_total) / report.rows_in : 0;
  const fil = report.rows_in ? (100 * report.filtered_total) / report.rows_in : 0;
  return (
    <div className={`run-summary ${stale ? "is-stale" : ""}`}>
      <div className="run-id">
        <span className={`status-dot is-${report.status}`} aria-hidden="true" />
        <span className="mono">run {shortId(report.run_id)}</span>
        <span className="badge">{TRIGGER[report.trigger] ?? report.trigger}</span>
        {report.replayed_from && (
          <button type="button" className="link-btn mono" onClick={() => onLoadParent(report.replayed_from)}>
            ↻ from {shortId(report.replayed_from)}
          </button>
        )}
        {report.status !== "success" && <span className="badge badge-bad">{report.status}</span>}
      </div>

      <div className="yield" title={`${pct.toFixed(1)}% of rows reached the output`}>
        <div className="yield-bar" aria-hidden="true">
          <span className="seg-out" style={{ width: `${pct}%` }} />
          <span className="seg-rej" style={{ width: `${rej}%` }} />
          <span className="seg-fil" style={{ width: `${fil}%` }} />
        </div>
        <div className="yield-legend mono">
          <span>{fmtInt(report.rows_in)} in</span>
          <span className="t-good">{fmtInt(report.rows_out)} out</span>
          <span className="t-bad">{fmtInt(report.rejected_total)} rejected</span>
          <span className="t-warn">{fmtInt(report.filtered_total)} filtered</span>
          <span className="muted">{fmtMs(report.duration_ms)}</span>
        </div>
      </div>

      <div className="run-actions">
        {stale && <span className="badge badge-warn" title="The pipeline was edited after this run">edited since run</span>}
        {report.rejected_total > 0 && (
          <a className="btn btn-ghost btn-sm" href={api.rejectsUrl(report.run_id)} download>
            <Icon name="download" size={14} /> rejects.csv
          </a>
        )}
        <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={onReplayStored}
          title="Re-run this run's stored config">
          <Icon name="replay" size={14} /> Replay
        </button>
        {stale && (
          <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={onReplayCurrent}
            title="Re-run with the edited pipeline, linked to this run">
            <Icon name="replay" size={14} /> Replay with edits
          </button>
        )}
      </div>
    </div>
  );
}
