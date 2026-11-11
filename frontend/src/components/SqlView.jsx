import React, { useEffect, useState } from "react";
import Icon from "./Icon";
import { api, downloadText } from "../api/client";
import { stableStringify } from "../lib/format";

/** The pipeline compiled to DuckDB SQL by the backend (generated, never run). */
export default function SqlView({ config, planValid }) {
  const [state, setState] = useState({ status: "idle" });
  const [copied, setCopied] = useState(false);
  const key = stableStringify({ d: config.dataset_id, s: config.stages });

  useEffect(() => {
    if (!planValid) { setState({ status: "invalid" }); return undefined; }
    let live = true;
    setState({ status: "loading" });
    api.compileSql(config)
      .then((r) => live && setState({ status: "ok", ...r }))
      .catch((e) => live && setState({ status: "error", message: e.message }));
    return () => { live = false; };
  }, [key, planValid]); // eslint-disable-line react-hooks/exhaustive-deps

  if (state.status === "invalid") return <div className="empty-note">Fix the pipeline's errors to compile it to SQL.</div>;
  if (state.status === "loading" || state.status === "idle") return <div className="skeleton" />;
  if (state.status === "error") return <div className="empty-note t-bad">{state.message}</div>;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(state.sql);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard unavailable: user can download instead */ }
  };

  return (
    <div className="sql-view">
      <div className="sql-toolbar">
        <span className="badge">DuckDB dialect</span>
        <span className="muted sql-hint">One CTE per stage. Generated for you to read or run elsewhere; Flowbench executes pipelines in Python.</span>
        <div className="sql-actions">
          <button type="button" className="btn btn-ghost btn-sm" onClick={copy}>
            <Icon name={copied ? "check" : "copy"} size={14} /> {copied ? "Copied" : "Copy"}
          </button>
          <button type="button" className="btn btn-ghost btn-sm"
            onClick={() => downloadText(`flowbench-${config.dataset_id}.sql`, `${state.setup_sql}\n${state.sql}`, "application/sql")}>
            <Icon name="download" size={14} /> .sql
          </button>
          <a className="btn btn-ghost btn-sm" href={api.datasetCsvUrl(config.dataset_id)} download>
            <Icon name="database" size={14} /> {config.dataset_id}.csv
          </a>
        </div>
      </div>
      {state.notes.length > 0 && (
        <ul className="issues">
          {state.notes.map((n) => (
            <li key={n} className="issue is-warning"><Icon name="alert" size={13} /> <span>{n}</span></li>
          ))}
        </ul>
      )}
      <pre className="code-block sql-code" aria-label="Compiled SQL"><code>{state.sql}</code></pre>
      <details className="sql-setup">
        <summary>Setup: create the tables (dataset from CSV, lookups inline)</summary>
        <pre className="code-block"><code>{state.setup_sql}</code></pre>
      </details>
    </div>
  );
}
