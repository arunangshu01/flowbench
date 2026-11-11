import React from "react";

// Decorative illustration of a pipeline: rows flow left to right and some
// drop into dead-letter lanes. Not live data, so it is hidden from AT.
const NODES = [
  { x: 6, label: "source", kind: "ingest" },
  { x: 128, label: "not_null", kind: "validator", drop: true },
  { x: 250, label: "range", kind: "validator", drop: true },
  { x: 372, label: "join", kind: "transform" },
  { x: 494, label: "sink", kind: "output" },
];

export default function HeroGraph() {
  return (
    <svg className="hero-graph" viewBox="0 0 600 150" aria-hidden="true" focusable="false">
      {NODES.slice(1).map((n, i) => (
        <g key={`e${i}`}>
          <line x1={NODES[i].x + 88} y1="46" x2={n.x} y2="46" className="hg-edge" />
          <line x1={NODES[i].x + 88} y1="46" x2={n.x} y2="46" className="hg-flow" style={{ animationDelay: `${i * 0.15}s` }} />
        </g>
      ))}
      {NODES.map((n, i) => (
        <g key={n.label} transform={`translate(${n.x},24)`}>
          <rect width="88" height="44" rx="9" className="hg-node" />
          <rect width="3" height="26" x="0" y="9" rx="1.5" className={`hg-accent kind-${n.kind}`} />
          <text x="14" y="27" className="hg-label">{n.label}</text>
          {n.drop && (
            <g transform="translate(44,44)">
              <line x1="0" y1="2" x2="0" y2="46" className="hg-drop-lane" />
              <circle r="3.2" className="hg-drop" style={{ animationDelay: `${i * 0.7}s` }} />
            </g>
          )}
        </g>
      ))}
      <text x="300" y="134" textAnchor="middle" className="hg-caption">rejected rows → dead-letter, with reasons</text>
    </svg>
  );
}
