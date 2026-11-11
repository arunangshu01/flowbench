import React from "react";
import Icon from "./Icon";
import ParamEditor from "./ParamEditor";
import { defaultParams, fitArgs } from "../lib/params";
import { summarizeStage } from "../lib/summary";
import { fmtInt } from "../lib/format";

export default function StageCard({
  stage, index, total, ops, opSpec, schemaIn, planStage, runStage, fnArity,
  selected, expanded, onSelect, onToggle, dispatch,
}) {
  const issues = planStage?.issues ?? [];
  const errors = issues.filter((i) => i.level === "error");
  const warns = issues.filter((i) => i.level === "warning");
  const outFields = planStage?.schema?.length;
  const state = errors.length ? "has-error" : warns.length ? "has-warning" : "";
  const bodyId = `stage-body-${index}`;

  const setParam = (name, value) => {
    if (stage.op === "derive_column" && name === "fn") {
      const params = { ...stage.params, fn: value, args: fitArgs(stage.params.args, fnArity?.[value] ?? 2, schemaIn) };
      dispatch({ type: "set_params", index, params });
      return;
    }
    dispatch({ type: "set_param", index, name, value });
  };

  const changeOp = (opName) => {
    const spec = ops.find((o) => o.name === opName);
    dispatch({ type: "set_stage_op", index, op: opName, params: defaultParams(spec, schemaIn) });
  };

  return (
    <li className={`stage-card kind-${stage.kind} ${state} ${selected ? "is-selected" : ""}`}>
      <div className="stage-node" aria-hidden="true">{index + 1}</div>
      <div className="stage-shell">
        <div className="stage-head">
          <button type="button" className="stage-title" onClick={onSelect}
            aria-expanded={expanded} aria-controls={bodyId}>
            <span className="stage-heading">
              <span className={`stage-kind kind-${stage.kind}`}>{stage.kind}</span>
              <span className="stage-op">{stage.op}</span>
            </span>
            {errors.length > 0 && <span className="issue-pill is-error"><Icon name="alert" size={12} />{errors.length}</span>}
            {warns.length > 0 && <span className="issue-pill is-warning"><Icon name="alert" size={12} />{warns.length}</span>}
          </button>
          <div className="stage-tools">
            <button type="button" className="icon-btn" title="Move up" aria-label={`Move stage ${index + 1} up`}
              disabled={index === 0} onClick={() => dispatch({ type: "move_stage", index, dir: -1 })}>
              <Icon name="up" size={14} />
            </button>
            <button type="button" className="icon-btn" title="Move down" aria-label={`Move stage ${index + 1} down`}
              disabled={index === total - 1} onClick={() => dispatch({ type: "move_stage", index, dir: 1 })}>
              <Icon name="down" size={14} />
            </button>
            <button type="button" className="icon-btn" title="Duplicate" aria-label={`Duplicate stage ${index + 1}`}
              onClick={() => dispatch({ type: "duplicate_stage", index })}>
              <Icon name="copy" size={14} />
            </button>
            <button type="button" className="icon-btn danger" title="Remove" aria-label={`Remove stage ${index + 1}`}
              onClick={() => dispatch({ type: "remove_stage", index })}>
              <Icon name="trash" size={14} />
            </button>
            <button type="button" className="icon-btn" title={expanded ? "Collapse" : "Expand"}
              aria-label={expanded ? `Collapse stage ${index + 1}` : `Expand stage ${index + 1}`}
              onClick={onToggle}>
              <Icon name={expanded ? "up" : "down"} size={14} />
            </button>
          </div>
        </div>

        {!expanded && <p className="stage-summary mono">{summarizeStage(stage)}</p>}

        {expanded && (
          <div className="stage-body" id={bodyId}>
            <label className="sr-only" htmlFor={`op-${index}`}>Operation</label>
            <select id={`op-${index}`} className="control" value={stage.op} onChange={(e) => changeOp(e.target.value)}>
              {ops.map((o) => <option key={o.name} value={o.name}>{o.name} - {o.category}</option>)}
            </select>
            {opSpec && <p className="stage-desc">{opSpec.description}</p>}
            <div className="params">
              {opSpec?.params.map((p) => (
                <ParamEditor key={`${stage.op}-${p.name}`} spec={p} value={stage.params[p.name]}
                  schema={schemaIn} stageParams={stage.params} fnArity={fnArity}
                  inputId={`p-${index}-${p.name}`}
                  onChange={(v) => setParam(p.name, v)} />
              ))}
            </div>
          </div>
        )}

        {issues.length > 0 && (
          <ul className="issues">
            {issues.map((iss, i) => (
              <li key={i} className={`issue is-${iss.level}`}>
                <Icon name="alert" size={13} /> <span>{iss.message}</span>
              </li>
            ))}
          </ul>
        )}

        <div className="stage-foot mono">
          <span title="Fields flowing into → out of this stage">
            {schemaIn.length} → {outFields ?? "?"} fields
          </span>
          {runStage && (
            <span className="stage-run">
              <b>{fmtInt(runStage.rows_out)}</b> out
              {runStage.rejected > 0 && <span className="t-bad"> · {fmtInt(runStage.rejected)} rejected</span>}
              {runStage.filtered > 0 && <span className="t-warn"> · {fmtInt(runStage.filtered)} filtered</span>}
            </span>
          )}
        </div>
      </div>
    </li>
  );
}
