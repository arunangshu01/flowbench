import React from "react";
import Icon from "./Icon";

const STEPS = [
  ["database", "Pick a source", "Seeded datasets from IoT, finance, healthcare, retail, logistics, aviation and more, including two with deliberately broken rows."],
  ["shield", "Add stages", "Validators reject bad rows; transforms reshape, filter, and enrich. Params are checked as you type."],
  ["inspect", "Run & inspect", "Real execution. Click any node to see its records, rejections, errors, and profile."],
];

export default function EmptyState({ onDemo, onRun, canRun, busy }) {
  return (
    <section className="panel empty-state">
      <div className="empty-head">
        <span className="kicker">getting started</span>
        <h2>Build a pipeline, run it, then inspect every stage.</h2>
      </div>
      <ol className="steps">
        {STEPS.map(([icon, title, text], i) => (
          <li key={title}>
            <span className="step-icon"><Icon name={icon} size={18} /></span>
            <div>
              <h3><span className="mono muted">0{i + 1}</span> {title}</h3>
              <p>{text}</p>
            </div>
          </li>
        ))}
      </ol>
      <div className="empty-actions">
        <button type="button" className="btn btn-primary" onClick={onDemo} disabled={busy}>
          <Icon name="spark" size={15} /> Run the faulty-sensor demo
        </button>
        <button type="button" className="btn" onClick={onRun} disabled={!canRun || busy}>
          <Icon name="play" size={13} /> Run current pipeline
        </button>
      </div>
      <p className="footnote">The demo loads the “Strict sensor ingestion” preset on the faulty dataset, so you can see rejections at each gate, fix a rule, and replay.</p>
    </section>
  );
}
