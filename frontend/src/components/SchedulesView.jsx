import React, { useState } from "react";
import Icon from "./Icon";
import { fmtDuration, relTime, shortId } from "../lib/format";
import { summarizeStage } from "../lib/summary";

const INTERVALS = [[60, "1 min"], [300, "5 min"], [900, "15 min"], [3600, "1 hour"]];

export default function SchedulesView({ schedules, config, planValid, now, maxSchedules, onCreate, onDelete, onLoad }) {
  const [interval, setIntervalS] = useState(300);
  const full = schedules.length >= maxSchedules;

  return (
    <div className="view">
      <section className="panel">
        <header className="panel-head">
          <div>
            <span className="kicker">schedules</span>
            <h2>Re-run a pipeline on an interval</h2>
          </div>
          <span className="muted mono">{schedules.length}/{maxSchedules}</span>
        </header>
        <p className="panel-note">
          Scheduled runs go through the same planner and bounded engine as manual runs and appear in History as
          <span className="via"><Icon name="clock" size={12} /> schedule</span>. The scheduler runs in-process and
          checks every 5 seconds.
        </p>

        <div className="schedule-create">
          <div className="schedule-preview">
            <span className="kicker">current pipeline</span>
            <div className="mono">{config.dataset_id} → {config.stages.length ? config.stages.map((s) => s.op).join(" → ") : "(no stages)"} → output</div>
          </div>
          <div className="segmented" role="radiogroup" aria-label="Interval">
            {INTERVALS.map(([s, label]) => (
              <button key={s} type="button" role="radio" aria-checked={interval === s}
                className={interval === s ? "is-active" : ""} onClick={() => setIntervalS(s)}>{label}</button>
            ))}
          </div>
          <button type="button" className="btn btn-primary" disabled={full || !planValid} onClick={() => onCreate(interval)}>
            <Icon name="clock" size={14} /> Schedule every {INTERVALS.find(([s]) => s === interval)[1]}
          </button>
        </div>
        {!planValid && <p className="footnote t-bad">Fix the pipeline's errors before scheduling it.</p>}
        {full && <p className="footnote">Schedule limit reached - delete one to add another.</p>}
      </section>

      <section className="panel">
        <header className="panel-head"><div><span className="kicker">active</span><h2>Scheduled pipelines</h2></div></header>
        {schedules.length === 0 ? <div className="empty-note">Nothing scheduled.</div> : (
          <ul className="schedule-list">
            {schedules.map((s) => {
              const last = s.last_run_at ? new Date(s.last_run_at).getTime() : null;
              const nextIn = last ? (last + s.interval_s * 1000 - now) / 1000 : 0;
              return (
                <li key={s.id} className="schedule-item">
                  <div className="schedule-main">
                    <div className="schedule-title">
                      <span className="mono">{shortId(s.id)}</span>
                      <span className="badge">every {fmtDuration(s.interval_s)}</span>
                      <span className="muted">{s.config.dataset_id}</span>
                    </div>
                    <div className="mono muted schedule-stages">
                      {s.config.stages.length ? s.config.stages.map((st) => summarizeStage(st)).join("  ·  ") : "no stages"}
                    </div>
                  </div>
                  <div className="schedule-timing mono">
                    <span>last: {s.last_run_at ? relTime(s.last_run_at, now) : "pending"}</span>
                    <span className="t-accent">next: {nextIn > 0 ? `in ${fmtDuration(nextIn)}` : "due now"}</span>
                  </div>
                  <div className="row-actions">
                    <button type="button" className="btn btn-ghost btn-xs" onClick={() => onLoad(s.config)}>
                      <Icon name="open" size={13} /> Load
                    </button>
                    <button type="button" className="btn btn-ghost btn-xs danger" onClick={() => onDelete(s.id)}>
                      <Icon name="trash" size={13} /> Delete
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
