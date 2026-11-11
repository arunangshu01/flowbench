import React, { useEffect, useRef, useState } from "react";
import Icon from "./Icon";

export default function AddStageMenu({ registry, onAdd, disabled, insertLabel }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const group = (title, kind, ops, icon) => (
    <div className="menu-group">
      <div className="menu-group-title"><Icon name={icon} size={14} /> {title}</div>
      {ops.map((o) => (
        <button key={o.name} type="button" role="menuitem" className={`menu-item kind-${kind}`}
          onClick={() => { onAdd(kind, o); setOpen(false); }}>
          <span className="menu-item-head">
            <span className="mono">{o.name}</span>
            <span className="menu-cat">{o.category}</span>
          </span>
          <span className="menu-item-desc">{o.description}</span>
        </button>
      ))}
    </div>
  );

  return (
    <div className="add-stage" ref={ref}>
      <button type="button" className="btn btn-dashed" disabled={disabled}
        aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <Icon name="plus" size={15} /> Add stage {insertLabel && <span className="muted">{insertLabel}</span>}
      </button>
      {open && (
        <div className="menu" role="menu">
          {group("Validators", "validator", registry.validators, "shield")}
          {group("Transforms", "transform", registry.transforms, "wand")}
        </div>
      )}
    </div>
  );
}
