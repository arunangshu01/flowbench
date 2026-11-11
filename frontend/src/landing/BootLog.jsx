import React, { useEffect, useRef, useState } from "react";
import { api, API_COMMON_PREFIX } from "../api/client";

const reduceMotion = () =>
  typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

// Each step is a real request; the log shows what actually came back.
const STEPS = [
  ["health", "probe api", () => api.health(), () => `${API_COMMON_PREFIX} online`],
  ["meta", "read limits", () => api.meta(),
    (m) => `v${m.version} · ${m.limits.max_rows.toLocaleString("en-US")} rows · ${m.limits.run_time_budget_s}s budget`],
  ["datasets", "load catalog", () => api.datasets(),
    (d) => `${d.length} datasets · ${new Set(d.map((x) => x.domain)).size} domains`],
  ["registry", "load operations", () => api.registry(),
    (r) => `${r.validators.length} validators · ${r.transforms.length} transforms`],
  ["presets", "load presets", () => api.presets(), (p) => `${p.length} preset pipelines`],
];

/**
 * Terminal-style boot sequence. Runs the checks in order, measuring each, and
 * reports the collected data via onReady (or onFail on the first failure).
 */
export default function BootLog({ onReady, onFail }) {
  const [lines, setLines] = useState([]);
  const [state, setState] = useState("booting");
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const pace = reduceMotion() ? 0 : 140;
    (async () => {
      const data = {};
      for (const [key, label, run, describe] of STEPS) {
        const t0 = performance.now();
        setLines((l) => [...l, { key, label, status: "run" }]);
        try {
          const value = await run();
          data[key] = value;
          const ms = Math.round(performance.now() - t0);
          setLines((l) => l.map((x) => (x.key === key ? { ...x, status: "ok", detail: describe(value), ms } : x)));
        } catch (e) {
          setLines((l) => l.map((x) => (x.key === key ? { ...x, status: "fail", detail: e.message } : x)));
          setState("failed");
          onFail?.(e);
          return;
        }
        if (pace) await new Promise((r) => setTimeout(r, pace));
      }
      setState("ready");
      onReady?.(data);
    })();
  }, [onReady, onFail]);

  return (
    <div className="boot" role="log" aria-live="polite" aria-label="Boot sequence">
      <div className="boot-chrome" aria-hidden="true">
        <i /><i /><i />
        <span>flowbench ~ boot</span>
      </div>
      <ol className="boot-lines">
        <li className="boot-line is-cmd"><span className="boot-prompt">$</span> flowbench boot --check</li>
        {lines.map((l) => (
          <li key={l.key} className={`boot-line is-${l.status}`}>
            <span className="boot-mark">{l.status === "ok" ? "ok" : l.status === "fail" ? "!!" : ".."}</span>
            <span className="boot-label">{l.label}</span>
            <span className="boot-detail">{l.detail ?? "…"}</span>
            {l.ms != null && <span className="boot-ms">{l.ms}ms</span>}
          </li>
        ))}
        {state === "ready" && (
          <li className="boot-line is-ready"><span className="boot-prompt">$</span> ready<span className="boot-caret" aria-hidden="true" /></li>
        )}
        {state === "failed" && (
          <li className="boot-line is-fail-hint">
            Backend unreachable. Start it with <code>uvicorn app.main:app --port 8000</code> in <code>backend/</code>.
          </li>
        )}
      </ol>
    </div>
  );
}
