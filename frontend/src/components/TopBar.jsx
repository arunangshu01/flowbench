import React, { useEffect, useRef, useState } from "react";
import Icon from "./Icon";
import Brand from "./Brand";

const VIEWS = [
  ["build", "Build", "build"],
  ["inspect", "Inspect", "inspect"],
  ["history", "History", "history"],
  ["schedules", "Schedules", "clock"],
];

function PresetsMenu({ presets, onLoad }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc); };
  }, [open]);
  return (
    <div className="presets" ref={ref}>
      <button type="button" className="btn btn-ghost" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <Icon name="layers" size={15} /> <span className="hide-sm">Presets</span> <Icon name="down" size={13} />
      </button>
      {open && (
        <div className="menu menu-right" role="menu">
          <div className="menu-group-title">Preset pipelines</div>
          {presets.map((p) => (
            <button key={p.id} type="button" role="menuitem" className="menu-item"
              onClick={() => { onLoad(p); setOpen(false); }}>
              <span className="menu-item-head"><span>{p.name}</span><span className="menu-cat mono">{p.config.dataset_id}</span></span>
              <span className="menu-item-desc">{p.description}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function TopBar({ view, onView, presets, onPreset, onShare, onRun, busy, planState }) {
  const blocked = planState === "error";
  return (
    <header className="topbar">
      <Brand />

      <nav className="view-tabs" aria-label="Views">
        {VIEWS.map(([id, label, icon]) => (
          <button key={id} type="button" className={`view-tab ${view === id ? "is-active" : ""} ${id === "build" ? "only-mobile" : ""}`}
            aria-current={view === id ? "page" : undefined} onClick={() => onView(id)}>
            <Icon name={icon} size={15} /> <span>{label}</span>
          </button>
        ))}
      </nav>

      <div className="topbar-actions">
        <PresetsMenu presets={presets} onLoad={onPreset} />
        <button type="button" className="btn btn-ghost" onClick={onShare} title="Copy a link to this pipeline">
          <Icon name="share" size={15} /> <span className="hide-sm">Share</span>
        </button>
        <button type="button" className="btn btn-run" onClick={onRun} disabled={busy || blocked}
          title={blocked ? "Fix the highlighted errors first" : "Run pipeline (⌘/Ctrl + Enter)"}>
          {busy ? <span className="spinner" aria-hidden="true" /> : <Icon name="play" size={13} />}
          <span>{busy ? "Running" : "Run"}</span>
          <kbd className="hide-sm">⌘↵</kbd>
        </button>
      </div>
    </header>
  );
}
