import React, { useEffect, useMemo, useState } from "react";
import Icon from "./Icon";
import RecordTable from "./RecordTable";
import ProfileTable from "./ProfileTable";
import SchemaDiff from "./SchemaDiff";
import SqlView from "./SqlView";
import { api } from "../api/client";
import { traceRid } from "../lib/lineage";
import { fmtInt, fmtMs, fmtPct } from "../lib/format";
import { summarizeStage } from "../lib/summary";

function Stat({ label, value, tone = "" }) {
  return (
    <div className={`stat ${tone}`}>
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
    </div>
  );
}

function TraceStrip({ trace, onClose }) {
  const label = {
    rejected: `rejected at stage ${trace.at?.index + 1} (${trace.at?.op})`,
    output: "reached the output",
    unknown: "outcome not visible in the recorded samples",
  }[trace.outcome];
  return (
    <div className={`trace trace-${trace.outcome}`} role="status">
      <div className="trace-head">
        <Icon name="link" size={14} />
        <span>record <b className="mono">#{trace.rid}</b> {label}</span>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Close trace"><Icon name="x" size={14} /></button>
      </div>
      <ol className="trace-steps">
        <li className="trace-step is-passed"><span>source</span></li>
        {trace.steps.map((s) => (
          <li key={s.stage.index} className={`trace-step is-${s.status}`} title={s.message ?? s.status}>
            <span className="mono">{s.stage.op}</span>
          </li>
        ))}
      </ol>
      {trace.message && <p className="trace-msg mono">{trace.message}</p>}
    </div>
  );
}

function Tabs({ tabs, active, onChange }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map(([id, label, count]) => (
        <button key={id} type="button" role="tab" aria-selected={active === id}
          className={`tab ${active === id ? "is-active" : ""}`} onClick={() => onChange(id)}>
          {label}{count != null && <span className="tab-count">{fmtInt(count)}</span>}
        </button>
      ))}
    </div>
  );
}

export default function NodeInspector({ config, plan, report, selected, registry }) {
  const n = config.stages.length;
  const isSource = selected === 0;
  const isSink = selected === n + 1;
  const stageIdx = !isSource && !isSink ? selected - 1 : null;
  const stageCfg = stageIdx != null ? config.stages[stageIdx] : null;
  const planStage = stageIdx != null ? plan?.stages?.[stageIdx] : null;
  const runStage = report ? (isSink ? null : report.stages[selected]) : null;
  const schemaIn = stageIdx == null ? plan?.input_schema ?? []
    : stageIdx === 0 ? plan?.input_schema ?? [] : plan?.stages?.[stageIdx - 1]?.schema ?? [];
  const schemaOut = isSink ? plan?.output_schema ?? [] : planStage?.schema ?? schemaIn;
  const opSpec = stageCfg && (stageCfg.kind === "validator" ? registry.validators : registry.transforms)
    .find((o) => o.name === stageCfg.op);

  const tabs = useMemo(() => {
    if (isSink) {
      return report
        ? [["records", "Output"], ["schema", "Schema evolution"], ["profile", "Profile"], ["sql", "SQL"], ["warnings", "Warnings", report.warnings?.length ?? 0]]
        : [["schema", "Schema evolution"], ["sql", "SQL"]];
    }
    if (isSource) return report ? [["records", "Rows read"], ["profile", "Profile"], ["schema", "Schema"]] : [["schema", "Schema"]];
    if (!runStage) return [["schema", "Schema"]];
    return [
      ["records", "Output", runStage.rows_out], ["input", "Input", runStage.rows_in],
      ["rejected", "Rejected", runStage.rejected], ["errors", "Errors", runStage.errors.length],
      ["profile", "Profile"], ["schema", "Schema"],
    ];
  }, [isSink, isSource, report, runStage]);

  const [chosenTab, setTab] = useState(tabs[0][0]);
  const [trace, setTrace] = useState(null);
  // derive synchronously: a tab chosen on another node may not exist here
  const tab = tabs.some((t) => t[0] === chosenTab) ? chosenTab : tabs[0][0];
  useEffect(() => { setTrace(null); setTab("records"); }, [report]);

  const onRid = report ? (rid) => setTrace(traceRid(report, rid)) : undefined;
  const title = isSource ? config.dataset_id : isSink ? "output" : stageCfg?.op;
  const kicker = isSource ? "source" : isSink ? "sink" : `stage ${stageIdx + 1} · ${stageCfg?.kind}`;
  const kind = isSource ? "ingest" : isSink ? "output" : stageCfg?.kind;

  let body = null;
  if (tab === "schema") {
    body = isSource
      ? <SchemaDiff before={plan?.input_schema ?? []} after={plan?.input_schema ?? []} beforeLabel="declared" afterLabel="emitted" />
      : <SchemaDiff before={isSink ? plan?.input_schema ?? [] : schemaIn} after={schemaOut}
          beforeLabel={isSink ? "source" : "in"} afterLabel={isSink ? "output" : "out"} />;
  } else if (tab === "profile") {
    body = <ProfileTable profile={isSink ? report?.output_profile : runStage?.profile} />;
  } else if (tab === "sql") {
    body = <SqlView config={config} planValid={!!plan?.valid} />;
  } else if (tab === "warnings") {
    body = report.warnings?.length
      ? <ul className="issues">{report.warnings.map((w, i) => (
          <li key={i} className="issue is-warning"><Icon name="alert" size={13} /> <span>stage {w.stage + 1} ({w.op}): {w.message}</span></li>
        ))}</ul>
      : <div className="empty-note">No planner warnings for this run.</div>;
  } else if (tab === "records") {
    if (isSink) {
      body = report.output.format === "csv"
        ? <pre className="code-block">{report.output.csv || "(no rows)"}</pre>
        : <RecordTable rows={report.output.sample} schema={plan?.output_schema} onRid={onRid} activeRid={trace?.rid}
            emptyText="No rows reached the output." />;
    } else {
      body = <RecordTable rows={runStage.sample_out} schema={schemaOut} onRid={onRid} activeRid={trace?.rid}
        emptyText="No rows passed this stage." />;
    }
  } else if (tab === "input") {
    body = <RecordTable rows={runStage.sample_in} schema={schemaIn} onRid={onRid} activeRid={trace?.rid} />;
  } else if (tab === "rejected") {
    body = <RecordTable rows={runStage.sample_rejected} schema={schemaIn} onRid={onRid} activeRid={trace?.rid}
      emptyText="Nothing rejected here." />;
  } else if (tab === "errors") {
    body = runStage.errors.length ? (
      <>
        <ul className="error-list">
          {runStage.errors.map((e, i) => (
            <li key={i}>
              <button type="button" className="rid-btn" onClick={() => onRid(e.rid)}>{e.rid}</button>
              <span className="mono">{e.message}</span>
            </li>
          ))}
        </ul>
        {runStage.rejected > runStage.errors.length && (
          <p className="footnote">Showing the first {runStage.errors.length} of {fmtInt(runStage.rejected)} errors. Download rejects.csv for the recorded set.</p>
        )}
      </>
    ) : <div className="empty-note">No validation errors at this stage.</div>;
  }

  const sampleNote = ["records", "input", "rejected"].includes(tab) && report
    ? `First ${report.output?.sample_size ?? 50} rows per bucket are sampled; counts and profiles cover every row.`
    : null;

  return (
    <section className="panel inspector" aria-label="Node inspector">
      <header className="inspector-head">
        <div className={`inspector-title kind-${kind}`}>
          <span className="kicker">{kicker}</span>
          <h2 className="mono">{title}</h2>
          {stageCfg && <p className="mono muted">{summarizeStage(stageCfg)}</p>}
          {opSpec && <p className="muted">{opSpec.description}</p>}
          {isSource && (
            <a className="btn btn-ghost btn-sm inspector-link" href={api.datasetCsvUrl(config.dataset_id)} download>
              <Icon name="download" size={14} /> Download {config.dataset_id}.csv
            </a>
          )}
        </div>
        {runStage && !isSource && (
          <div className="stats">
            <Stat label="in" value={fmtInt(runStage.rows_in)} />
            <Stat label="out" value={fmtInt(runStage.rows_out)} />
            <Stat label="rejected" value={fmtInt(runStage.rejected)} tone={runStage.rejected ? "is-bad" : ""} />
            <Stat label="filtered" value={fmtInt(runStage.filtered)} tone={runStage.filtered ? "is-warn" : ""} />
            <Stat label="pass rate" value={fmtPct(runStage.rows_out, runStage.rows_in)} />
            <Stat label="stage time" value={fmtMs(runStage.duration_ms)} />
          </div>
        )}
        {isSource && report && (
          <div className="stats">
            <Stat label="rows read" value={fmtInt(report.stages[0].rows_in)} />
            <Stat label="read time" value={fmtMs(report.stages[0].duration_ms)} />
          </div>
        )}
        {isSink && report && (
          <div className="stats">
            <Stat label="rows in" value={fmtInt(report.rows_in)} />
            <Stat label="rows out" value={fmtInt(report.rows_out)} />
            <Stat label="rejected" value={fmtInt(report.rejected_total)} tone={report.rejected_total ? "is-bad" : ""} />
            <Stat label="filtered" value={fmtInt(report.filtered_total)} tone={report.filtered_total ? "is-warn" : ""} />
            <Stat label="yield" value={fmtPct(report.rows_out, report.rows_in)} />
          </div>
        )}
      </header>

      {planStage?.issues?.length > 0 && (
        <ul className="issues">
          {planStage.issues.map((iss, i) => (
            <li key={i} className={`issue is-${iss.level}`}><Icon name="alert" size={13} /> <span>{iss.message}</span></li>
          ))}
        </ul>
      )}

      {trace && <TraceStrip trace={trace} onClose={() => setTrace(null)} />}

      <Tabs tabs={tabs} active={tab} onChange={setTab} />
      <div className="tab-body">{body}</div>
      {sampleNote && <p className="footnote">{sampleNote} Click a <span className="mono">rid</span> to trace a record.</p>}
      {!report && !isSource && !isSink && (
        <p className="footnote">Run the pipeline to see this stage's records, rejections, and profile.</p>
      )}
    </section>
  );
}
