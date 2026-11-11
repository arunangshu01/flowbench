import React from "react";
import CreatorMark from "./CreatorMark";
import { fmtInt } from "../lib/format";

export default function StatusBar({ apiOk, plan, planPending, meta }) {
  const errs = plan?.stages?.reduce((n, s) => n + s.issues.filter((i) => i.level === "error").length, 0) ?? 0;
  const warns = plan?.stages?.reduce((n, s) => n + s.issues.filter((i) => i.level === "warning").length, 0) ?? 0;
  const lim = meta?.limits;
  return (
    <footer className="statusbar">
      <div className="status-left">
        <span className={`status-item ${apiOk ? "" : "t-bad"}`}>
          <span className={`status-dot ${apiOk ? "is-success" : "is-error"}`} aria-hidden="true" />
          {apiOk ? "api online" : "api offline"}
        </span>
        <span className={`status-item ${errs ? "t-bad" : warns ? "t-warn" : "t-good"}`}>
          {planPending ? "planning…" : errs ? `plan: ${errs} error${errs > 1 ? "s" : ""}` : warns ? `plan ok · ${warns} warning${warns > 1 ? "s" : ""}` : "plan ok"}
        </span>
        {lim && (
          <span className="status-item muted hide-md">
            {lim.runs_per_minute} runs/min · {fmtInt(lim.max_rows)} rows · {lim.run_time_budget_s}s budget
          </span>
        )}
        {meta?.version && <span className="status-item muted hide-md">v{meta.version}</span>}
      </div>
      <CreatorMark variant="bar" />
    </footer>
  );
}
