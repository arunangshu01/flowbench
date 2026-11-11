import React, { useEffect, useRef, useState } from "react";
import { fmtInt } from "../lib/format";
import { summarizeStage } from "../lib/summary";

const W = 160;      // node width
const H = 78;       // node height
const GAP = 52;     // horizontal gap between nodes
const PAD_X = 16;
const PAD_Y = 18;
const STUB = 30;    // dead-letter stub length below a node
const MIN_SCALE = 0.72;

// Shrink the graph to fit its container (down to MIN_SCALE), then scroll,
// fading the right edge while more graph is hidden.
function useFitScale(naturalWidth) {
  const ref = useRef(null);
  const [scale, setScale] = useState(1);
  const [overflow, setOverflow] = useState({ over: false, end: false });
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return undefined;
    const measure = () => setOverflow({
      over: el.scrollWidth > el.clientWidth + 1,
      end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 2,
    });
    const ro = new ResizeObserver(([entry]) => {
      setScale(Math.max(MIN_SCALE, Math.min(1, entry.contentRect.width / naturalWidth)));
      requestAnimationFrame(measure);
    });
    ro.observe(el);
    el.addEventListener("scroll", measure, { passive: true });
    return () => { ro.disconnect(); el.removeEventListener("scroll", measure); };
  }, [naturalWidth]);
  return [ref, scale, overflow];
}

const trunc = (s, n) => (s && s.length > n ? `${s.slice(0, n - 1)}…` : s ?? "");

/**
 * Horizontal DAG: source -> stages -> sink. Edge thickness scales with rows
 * flowing; rejected/filtered rows branch down into dead-letter pills.
 */
export default function DagCanvas({ config, plan, report, selected, onSelect, running }) {
  const stages = config.stages;
  const nodes = [
    { kind: "ingest", title: "source", sub: config.dataset_id },
    ...stages.map((s, i) => ({ kind: s.kind, title: s.op, sub: summarizeStage(s), stage: i })),
    { kind: "output", title: "sink", sub: `${config.output_format} · ${plan?.output_schema?.length ?? "?"} fields` },
  ];

  const counts = (i) => {
    if (!report) return null;
    if (i === 0) return { out: report.stages[0].rows_out };
    if (i === nodes.length - 1) return { out: report.rows_out, final: true };
    const s = report.stages[i];
    return s && { in: s.rows_in, out: s.rows_out, rejected: s.rejected, filtered: s.filtered, ms: s.duration_ms };
  };

  const maxRows = Math.max(1, report?.rows_in ?? 1);
  const width = PAD_X * 2 + nodes.length * W + (nodes.length - 1) * GAP;
  const height = PAD_Y * 2 + H + STUB + 26;
  const x = (i) => PAD_X + i * (W + GAP);
  const cy = PAD_Y + H / 2;
  const [ref, scale, overflow] = useFitScale(width);

  return (
    <div className={`dag-scroll ${overflow.over ? "is-overflowing" : ""} ${overflow.end ? "is-scrolled-end" : ""}`} ref={ref}>
      <svg className={`dag-svg ${running ? "is-running" : ""}`} width={width * scale} height={height * scale}
        viewBox={`0 0 ${width} ${height}`} role="group" aria-label="Pipeline graph">
        <defs>
          <marker id="dag-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="9" markerHeight="9"
            markerUnits="userSpaceOnUse" orient="auto">
            <path d="M0 0 10 5 0 10z" className="dag-arrowhead" />
          </marker>
        </defs>

        {nodes.slice(1).map((_, k) => {
          const i = k + 1;
          const flow = counts(i - 1)?.out;
          const w = flow == null ? 2 : 1.5 + 4 * Math.sqrt(flow / maxRows);
          const x1 = x(i - 1) + W + 2;
          const x2 = x(i) - 3;
          return (
            <g key={`e${i}`} className="dag-edge">
              <line x1={x1} y1={cy} x2={x2} y2={cy} strokeWidth={w} className="edge-line" markerEnd="url(#dag-arrow)" />
              {running && <line x1={x1} y1={cy} x2={x2} y2={cy} className="edge-flow" />}
              {flow != null && (
                <text x={(x1 + x2) / 2 - 2} y={cy - 11} className="edge-label" textAnchor="middle">{fmtInt(flow)}</text>
              )}
            </g>
          );
        })}

        {nodes.map((n, i) => {
          const c = counts(i);
          const planIssues = n.stage != null ? plan?.stages?.[n.stage]?.issues ?? [] : [];
          const hasErr = planIssues.some((p) => p.level === "error");
          const hasWarn = !hasErr && planIssues.some((p) => p.level === "warning");
          const lost = (c?.rejected ?? 0) + (c?.filtered ?? 0);
          const nx = x(i);
          return (
            <g key={`n${i}`} className={`dag-node kind-${n.kind} ${selected === i ? "is-selected" : ""} ${hasErr ? "has-error" : ""} ${hasWarn ? "has-warning" : ""}`}
              transform={`translate(${nx},${PAD_Y})`} role="button" tabIndex={0}
              aria-label={`${n.title} ${n.sub}`} aria-pressed={selected === i}
              onClick={() => onSelect(i)}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(i); } }}>
              <title>{`${n.title} - ${n.sub}`}</title>
              <rect className="node-box" width={W} height={H} rx="10" />
              <rect className="node-accent" width="4" height={H - 20} x="0" y="10" rx="2" />
              <text x="16" y="24" className="node-kicker">
                {n.kind === "ingest" ? "SOURCE" : n.kind === "output" ? "SINK" : `${String(n.stage + 1).padStart(2, "0")} · ${n.kind.toUpperCase()}`}
              </text>
              <text x="16" y="44" className="node-title">{trunc(n.title, 18)}</text>
              <text x="16" y="62" className="node-sub">
                {c && c.in != null ? `${fmtInt(c.in)} → ${fmtInt(c.out)}` : c ? `${fmtInt(c.out)} rows` : trunc(n.sub, 22)}
              </text>
              {hasErr && <circle cx={W - 14} cy="14" r="5" className="node-dot is-error" />}
              {hasWarn && <circle cx={W - 14} cy="14" r="5" className="node-dot is-warning" />}
              {lost > 0 && (
                <g className="dead-letter" transform={`translate(${W / 2},${H})`}>
                  <line x1="0" y1="0" x2="0" y2={STUB - 8} />
                  <g transform={`translate(0,${STUB})`}>
                    {c.rejected > 0 && (
                      <g className="dl-pill is-rejected" transform={`translate(${c.filtered > 0 ? -38 : 0},0)`}>
                        <rect x="-34" y="-11" width="68" height="22" rx="11" />
                        <text textAnchor="middle" y="4">✕ {fmtInt(c.rejected)}</text>
                      </g>
                    )}
                    {c.filtered > 0 && (
                      <g className="dl-pill is-filtered" transform={`translate(${c.rejected > 0 ? 38 : 0},0)`}>
                        <rect x="-34" y="-11" width="68" height="22" rx="11" />
                        <text textAnchor="middle" y="4">- {fmtInt(c.filtered)}</text>
                      </g>
                    )}
                  </g>
                </g>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
