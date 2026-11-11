import React, { useEffect, useState } from "react";
import Icon from "./Icon";
import { displayScalar, fitArgs, parseScalar, scalarType } from "../lib/params";

function FieldSelect({ value, schema, onChange, id, placeholder = "choose field…" }) {
  const known = schema.some((f) => f.name === value);
  return (
    <select id={id} className={`control ${value && !known ? "is-invalid" : ""}`}
      value={value ?? ""} onChange={(e) => onChange(e.target.value || undefined)}>
      <option value="" disabled>{placeholder}</option>
      {value && !known && <option value={value}>{value} (not available here)</option>}
      {schema.map((f) => (
        <option key={f.name} value={f.name}>{f.name} · {f.type}</option>
      ))}
    </select>
  );
}

function Chip({ children, onRemove, tone = "" }) {
  return (
    <span className={`chip-token ${tone}`}>
      {children}
      <button type="button" className="chip-x" onClick={onRemove} aria-label={`Remove ${children}`}>
        <Icon name="x" size={12} />
      </button>
    </span>
  );
}

function FieldsEditor({ value = [], schema, onChange, id }) {
  const names = new Set(schema.map((f) => f.name));
  const remaining = schema.filter((f) => !value.includes(f.name));
  return (
    <div className="chips-editor">
      {value.map((v) => (
        <Chip key={v} tone={names.has(v) ? "" : "is-invalid"}
          onRemove={() => onChange(value.filter((x) => x !== v))}>{v}</Chip>
      ))}
      {remaining.length > 0 && (
        <select id={id} className="control chip-add" value=""
          onChange={(e) => e.target.value && onChange([...value, e.target.value])}
          aria-label="Add field">
          <option value="">+ add field</option>
          {remaining.map((f) => <option key={f.name} value={f.name}>{f.name} · {f.type}</option>)}
        </select>
      )}
    </div>
  );
}

function ValuesEditor({ value = [], onChange, id, placeholder = "type a value, press Enter" }) {
  const [draft, setDraft] = useState("");
  const commit = () => {
    const tokens = draft.split(",").map((t) => t.trim()).filter(Boolean);
    if (tokens.length) onChange([...value, ...tokens.map(parseScalar)]);
    setDraft("");
  };
  return (
    <div className="chips-editor">
      {value.map((v, i) => (
        <Chip key={`${i}-${String(v)}`} onRemove={() => onChange(value.filter((_, j) => j !== i))}>
          {displayScalar(v)}
        </Chip>
      ))}
      <input id={id} className="control chip-input" value={draft} placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") { e.preventDefault(); commit(); }
          if (e.key === "Backspace" && !draft && value.length) onChange(value.slice(0, -1));
        }} />
    </div>
  );
}

function Segmented({ options, value, onChange, label }) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o} type="button" role="radio" aria-checked={value === o}
          className={value === o ? "is-active" : ""} onClick={() => onChange(o)}>{o}</button>
      ))}
    </div>
  );
}

function EnumEditor({ spec, value, onChange, id }) {
  const opts = spec.options ?? [];
  const current = value ?? spec.default;
  if (opts.length <= 4 && opts.every((o) => o.length <= 8)) {
    return <Segmented options={opts} value={current} onChange={onChange} label={spec.name} />;
  }
  return (
    <select id={id} className="control" value={current ?? ""} onChange={(e) => onChange(e.target.value)}>
      {!current && <option value="" disabled>choose…</option>}
      {opts.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}

function ScalarInput({ value, onChange, id }) {
  const [text, setText] = useState(displayScalar(value));
  const parsed = parseScalar(text);
  // resync when the value is replaced from outside (preset, loaded run)
  useEffect(() => {
    if (parseScalar(text) !== value) setText(displayScalar(value));
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="input-affix">
      <input id={id} className="control" value={text} placeholder="value"
        onChange={(e) => { setText(e.target.value); onChange(parseScalar(e.target.value)); }} />
      <span className="affix">{scalarType(parsed)}</span>
    </div>
  );
}

function MappingEditor({ value = {}, schema, onChange }) {
  const entries = Object.entries(value);
  const set = (list) => onChange(Object.fromEntries(list));
  const unused = schema.filter((f) => !(f.name in value));
  return (
    <div className="rows-editor">
      {entries.map(([oldName, newName], i) => (
        <div className="map-row" key={oldName}>
          <FieldSelect value={oldName} schema={schema.filter((f) => f.name === oldName || !(f.name in value))}
            onChange={(v) => set(entries.map((e, j) => (j === i ? [v, e[1]] : e)))} />
          <span className="map-arrow">→</span>
          <input className="control" value={newName} aria-label={`New name for ${oldName}`}
            onChange={(e) => set(entries.map((x, j) => (j === i ? [x[0], e.target.value] : x)))} />
          <button type="button" className="icon-btn" aria-label={`Remove mapping ${oldName}`}
            onClick={() => set(entries.filter((_, j) => j !== i))}><Icon name="x" size={14} /></button>
        </div>
      ))}
      {unused.length > 0 && (
        <button type="button" className="btn btn-ghost btn-sm"
          onClick={() => set([...entries, [unused[0].name, `${unused[0].name}_renamed`]])}>
          <Icon name="plus" size={14} /> add rename
        </button>
      )}
    </div>
  );
}

function ArgsEditor({ value = [], schema, onChange, arity }) {
  const args = fitArgs(value, arity ?? value.length, schema);
  const setArg = (i, v) => onChange(args.map((a, j) => (j === i ? v : a)));
  return (
    <div className="rows-editor">
      {args.map((a, i) => {
        const mode = a && typeof a === "object" ? "field" : typeof a === "number" ? "number" : "text";
        return (
          <div className="arg-row" key={i}>
            <span className="arg-index">arg {i + 1}</span>
            <Segmented options={["field", "number", "text"]} value={mode} label={`arg ${i + 1} kind`}
              onChange={(m) => setArg(i, m === "field" ? { field: schema[0]?.name } : m === "number" ? 0 : "")} />
            {mode === "field" && (
              <FieldSelect value={a.field} schema={schema} onChange={(v) => setArg(i, { field: v })} />
            )}
            {mode === "number" && (
              <input className="control" type="number" step="any" value={a}
                aria-label={`arg ${i + 1} number`}
                onChange={(e) => setArg(i, e.target.value === "" ? 0 : Number(e.target.value))} />
            )}
            {mode === "text" && (
              <input className="control" value={a} aria-label={`arg ${i + 1} text`}
                onChange={(e) => setArg(i, e.target.value)} />
            )}
          </div>
        );
      })}
    </div>
  );
}

/** One labelled param control, chosen by the registry's param type. */
export default function ParamEditor({ spec, value, schema, stageParams, fnArity, onChange, inputId }) {
  let control;
  switch (spec.type) {
    case "field":
      control = <FieldSelect id={inputId} value={value} schema={schema} onChange={onChange} />;
      break;
    case "fields":
      control = <FieldsEditor id={inputId} value={value} schema={schema} onChange={onChange} />;
      break;
    case "number":
      control = (
        <input id={inputId} className="control" type="number" step="any"
          value={value ?? ""} placeholder={spec.required ? "required" : "optional"}
          onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))} />
      );
      break;
    case "enum":
      control = <EnumEditor id={inputId} spec={spec} value={value} onChange={onChange} />;
      break;
    case "values":
      control = <ValuesEditor id={inputId} value={value} onChange={onChange} />;
      break;
    case "value":
      control = stageParams?.op === "in"
        ? <ValuesEditor id={inputId} value={Array.isArray(value) ? value : []} onChange={onChange} />
        : <ScalarInput id={inputId} value={Array.isArray(value) ? "" : value} onChange={onChange} />;
      break;
    case "mapping":
      control = <MappingEditor value={value} schema={schema} onChange={onChange} />;
      break;
    case "args":
      control = <ArgsEditor value={value} schema={schema} onChange={onChange}
        arity={fnArity?.[stageParams?.fn]} />;
      break;
    default:
      control = (
        <input id={inputId} className="control" value={value ?? ""}
          placeholder={spec.required ? "required" : "optional"}
          onChange={(e) => onChange(e.target.value === "" ? undefined : e.target.value)} />
      );
  }

  return (
    <div className="param">
      <label className="param-label" htmlFor={inputId}>
        <span className="param-name">{spec.name}</span>
        {!spec.required && <span className="param-opt">optional</span>}
      </label>
      {control}
      {spec.description && <p className="param-help">{spec.description}</p>}
    </div>
  );
}
