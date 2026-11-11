import React from "react";
import Icon from "./Icon";

export default function Toasts({ toasts, onDismiss }) {
  return (
    <div className="toasts" aria-live="polite" aria-atomic="false">
      {toasts.map((t) => (
        <div key={t.id} className={`toast is-${t.tone}`} role={t.tone === "error" ? "alert" : "status"}>
          <Icon name={t.tone === "error" ? "alert" : t.tone === "success" ? "check" : "spark"} size={15} />
          <div className="toast-body">
            <div className="toast-title">{t.title}</div>
            {t.text && <div className="toast-text">{t.text}</div>}
          </div>
          <button type="button" className="icon-btn" onClick={() => onDismiss(t.id)} aria-label="Dismiss">
            <Icon name="x" size={13} />
          </button>
        </div>
      ))}
    </div>
  );
}
