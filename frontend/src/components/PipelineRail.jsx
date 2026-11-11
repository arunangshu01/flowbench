import React, { useEffect, useState } from "react";
import Icon from "./Icon";
import StageCard from "./StageCard";
import AddStageMenu from "./AddStageMenu";
import RecordTable from "./RecordTable";
import { api } from "../api/client";
import { defaultParams } from "../lib/params";
import { fmtInt } from "../lib/format";

function SourceCard({ datasets, dataset, onChange, selected, onSelect }) {
  const [peek, setPeek] = useState(false);
  const [sample, setSample] = useState(null);

  useEffect(() => {
    setSample(null);
    if (peek && dataset) api.sample(dataset.id, 8).then(setSample).catch(() => setSample({ rows: [] }));
  }, [peek, dataset]);

  return (
    <section className={`rail-block source-block ${selected ? "is-selected" : ""}`}>
      <div className="rail-block-head">
        <button type="button" className="rail-block-title" onClick={onSelect}>
          <span className="kind-tag kind-ingest">source</span>
          <span>Dataset</span>
        </button>
        {dataset && <span className="mono muted">{fmtInt(dataset.row_count)} rows</span>}
      </div>
      <label className="sr-only" htmlFor="dataset-select">Dataset</label>
      <select id="dataset-select" className="control" value={dataset?.id ?? ""} onChange={(e) => onChange(e.target.value)}>
        {[...new Set(datasets.map((d) => d.domain))].map((domain) => (
          <optgroup key={domain} label={domain}>
            {datasets.filter((d) => d.domain === domain).map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </optgroup>
        ))}
      </select>
      {dataset && (
        <div className="dataset-tags">
          <span className="badge">{dataset.domain}</span>
          {dataset.faulty && <span className="badge badge-warn">injected defects</span>}
        </div>
      )}
      {dataset && <p className="block-desc">{dataset.description}</p>}
      {dataset && (
        <div className="schema-chips">
          {dataset.schema.map((f) => (
            <span key={f.name} className="field-chip" title={f.description}>
              <span className="mono">{f.name}</span><span className={`type-dot t-${f.type}`}>{f.type}</span>
            </span>
          ))}
        </div>
      )}
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPeek((v) => !v)} aria-expanded={peek}>
        <Icon name={peek ? "up" : "down"} size={14} /> {peek ? "Hide" : "Peek at"} raw rows
      </button>
      {peek && (sample ? <RecordTable rows={sample.rows} compact /> : <div className="skeleton" />)}
    </section>
  );
}

export default function PipelineRail({
  config, dispatch, datasets, registry, plan, freshReport, selected, onSelect,
}) {
  const [expanded, setExpanded] = useState(() => new Set([0]));
  const dataset = datasets.find((d) => d.id === config.dataset_id);
  const inputSchema = plan?.input_schema ?? dataset?.schema ?? [];
  const schemaAt = (i) => (i === 0 ? inputSchema : plan?.stages?.[i - 1]?.schema ?? inputSchema);
  const opsFor = (kind) => (kind === "validator" ? registry.validators : registry.transforms);
  const stageSel = selected >= 1 && selected <= config.stages.length ? selected - 1 : null;

  // auto-expand stages that gain errors, and the selected stage
  useEffect(() => {
    setExpanded((prev) => {
      const next = new Set(prev);
      plan?.stages?.forEach((s) => { if (s.issues.some((i) => i.level === "error")) next.add(s.index); });
      if (stageSel !== null) next.add(stageSel);
      return next.size === prev.size ? prev : next;
    });
  }, [plan, stageSel]);

  const toggle = (i) => setExpanded((prev) => {
    const next = new Set(prev);
    next.has(i) ? next.delete(i) : next.add(i);
    return next;
  });

  const add = (kind, op) => {
    const at = stageSel !== null ? stageSel + 1 : config.stages.length;
    dispatch({ type: "add_stage", kind, op: op.name, index: at, params: defaultParams(op, schemaAt(at)) });
    setExpanded((prev) => new Set([...[...prev].map((i) => (i >= at ? i + 1 : i)), at]));
    onSelect(at + 1);
  };

  return (
    <div className="rail">
      <SourceCard datasets={datasets} dataset={dataset} selected={selected === 0} onSelect={() => onSelect(0)}
        onChange={(id) => dispatch({ type: "set_dataset", dataset_id: id })} />

      <div className="rail-section-label">
        <span>Stages</span>
        <span className="mono muted">{config.stages.length}/20</span>
      </div>

      {config.stages.length === 0 && (
        <p className="rail-empty">No stages yet - rows pass straight from source to output. Add a validator or transform.</p>
      )}

      <ol className="stage-list">
        {config.stages.map((st, i) => (
          <StageCard key={i} stage={st} index={i} total={config.stages.length}
            ops={opsFor(st.kind)} opSpec={opsFor(st.kind).find((o) => o.name === st.op)}
            schemaIn={schemaAt(i)} planStage={plan?.stages?.[i]}
            runStage={freshReport?.stages?.[i + 1]} fnArity={registry.fn_arity}
            selected={stageSel === i} expanded={expanded.has(i)}
            onSelect={() => { onSelect(i + 1); if (!expanded.has(i)) toggle(i); }}
            onToggle={() => toggle(i)} dispatch={dispatch} />
        ))}
      </ol>

      <AddStageMenu registry={registry} onAdd={add} disabled={config.stages.length >= 20}
        insertLabel={stageSel !== null && stageSel < config.stages.length - 1 ? `after #${stageSel + 1}` : ""} />

      <section className={`rail-block output-block ${selected === config.stages.length + 1 ? "is-selected" : ""}`}>
        <div className="rail-block-head">
          <button type="button" className="rail-block-title" onClick={() => onSelect(config.stages.length + 1)}>
            <span className="kind-tag kind-output">sink</span>
            <span>Output</span>
          </button>
          <span className="mono muted">{plan?.output_schema?.length ?? "?"} fields</span>
        </div>
        <div className="segmented segmented-wide" role="radiogroup" aria-label="Output format">
          {[["records", "JSON records"], ["csv", "CSV"]].map(([v, label]) => (
            <button key={v} type="button" role="radio" aria-checked={config.output_format === v}
              className={config.output_format === v ? "is-active" : ""}
              onClick={() => dispatch({ type: "set_output_format", output_format: v })}>{label}</button>
          ))}
        </div>
      </section>
    </div>
  );
}
