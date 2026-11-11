import React, { useCallback, useState } from "react";
import Icon from "../components/Icon";
import CreatorMark from "../components/CreatorMark";
import BootLog from "./BootLog";
import HeroGraph from "./HeroGraph";
import { encodeConfig } from "../api/client";
import { ROUTES, linkTo } from "../lib/router";
import { fmtInt } from "../lib/format";
import { summarizeStage } from "../lib/summary";
import "./landing.css";

const REPO = "https://github.com/arunangshu01/flowbench";
const DEMO = `${ROUTES.app}?demo=strict-sensor-ingest`;
const openConfig = (config) => `${ROUTES.app}#config=${encodeConfig(config)}`;

const STEPS = [
  ["database", "Pick a source", "Choose a seeded dataset. Two of them ship with deliberately broken rows."],
  ["shield", "Compose stages", "Chain validators and transforms with typed controls. The planner checks every field reference as you edit."],
  ["play", "Run for real", "Rows stream through each stage in-process, with exact counts and per-stage timings."],
  ["inspect", "Inspect & replay", "Open any node for records, rejections, profiles and lineage. Fix a rule, replay, compare."],
];

const FEATURES = [
  ["layers", "Static planning", "Schema is propagated through renames, drops, casts and joins before a single row runs. Invalid pipelines are refused."],
  ["play", "Real, bounded execution", "Lazy streaming engine with a row cap, stage cap, 10 s budget, rate limit and concurrency cap."],
  ["link", "Record lineage", "Every row carries a lineage id. Trace one through the DAG to the stage that rejected it, and why."],
  ["inspect", "Per-field profiles", "Null rates, distinct counts, ranges and mixed-type detection over every row, at every stage."],
  ["compare", "Replay & compare", "Replay a run with edits, then diff two runs. Stages align by operation, not position."],
  ["download", "Dead-letter export", "Download rejected records with stage, row, lineage id and reason as a clean CSV."],
  ["clock", "Schedules", "Re-run a pipeline on an interval and watch history accumulate through the same engine."],
  ["share", "Shareable pipelines", "The whole pipeline lives in the URL. Send a link, get the exact same configuration."],
];

const STACK = [
  ["Backend", "FastAPI + Pydantic, pure-Python streaming engine, SQLite (WAL) history"],
  ["Frontend", "React 18 + Vite, hand-rolled SVG graph, no UI or icon libraries"],
  ["Safety", "Whitelisted ops only: no arbitrary code, SQL or remote URLs"],
  ["Deploy", "Firebase Hosting + Cloud Run with keyless GitHub Actions (planned)"],
];

function Stat({ value, label }) {
  return (
    <div className="lp-stat">
      <span className="lp-stat-value">{value ?? <span className="lp-skel" />}</span>
      <span className="lp-stat-label">{label}</span>
    </div>
  );
}

function Section({ id, kicker, title, intro, children }) {
  return (
    <section className="lp-section" id={id} aria-labelledby={`${id}-title`}>
      <div className="lp-section-head">
        <span className="kicker">{kicker}</span>
        <h2 id={`${id}-title`}>{title}</h2>
        {intro && <p>{intro}</p>}
      </div>
      {children}
    </section>
  );
}

export default function Landing() {
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState(false);
  const onReady = useCallback((d) => setData(d), []);
  const onFail = useCallback(() => setFailed(true), []);

  const datasets = data?.datasets ?? [];
  const domains = new Set(datasets.map((d) => d.domain));
  const opCount = data ? data.registry.validators.length + data.registry.transforms.length : null;

  return (
    <div className="landing">
      <header className="lp-nav">
        <a className="lp-brand" {...linkTo(ROUTES.landing)} aria-label="Flowbench home">
          <img src="/logo.svg" width="30" height="30" alt="" />
          <span>flowbench</span>
        </a>
        <nav className="lp-links" aria-label="Sections">
          <a href="#how">How it works</a>
          <a href="#features">Features</a>
          <a href="#datasets">Datasets</a>
          <a href="#presets">Presets</a>
          <a href={REPO} target="_blank" rel="noreferrer">GitHub</a>
        </nav>
        <a className="btn btn-primary" {...linkTo(ROUTES.app)} aria-label="Launch workbench">
          Launch<span className="lp-hide-xs">&nbsp;workbench</span> <Icon name="open" size={14} />
        </a>
      </header>

      <main>
        <section className="lp-hero">
          <div className="lp-hero-copy">
            <span className="lp-eyebrow"><span className="lp-pulse" aria-hidden="true" />data pipeline playground</span>
            <h1>Build a pipeline. <span className="lp-grad">Break it.</span> Inspect every row.</h1>
            <p className="lp-lede">
              Flowbench runs real validation and transformation pipelines on seeded datasets, then
              lets you open every stage: what came in, what went out, what was rejected and why.
            </p>
            <div className="lp-ctas">
              <a className="btn btn-run lp-cta" {...linkTo(DEMO)}>
                <Icon name="spark" size={15} /> Run the faulty-data demo
              </a>
              <a className="btn lp-cta" {...linkTo(ROUTES.app)}>
                Open empty workbench <Icon name="open" size={14} />
              </a>
            </div>
            <ul className="lp-checks">
              <li><Icon name="check" size={14} /> No sign-up</li>
              <li><Icon name="check" size={14} /> Real execution, not a simulation</li>
              <li><Icon name="check" size={14} /> Works on phone, tablet and desktop</li>
            </ul>
          </div>

          <div className="lp-hero-visual">
            <BootLog onReady={onReady} onFail={onFail} />
            <div className="lp-graph-card"><HeroGraph /></div>
          </div>
        </section>

        <div className="lp-stats" aria-label="Live catalog">
          <Stat value={data && datasets.length} label="datasets" />
          <Stat value={data && domains.size} label="domains" />
          <Stat value={opCount} label="operations" />
          <Stat value={data && data.presets.length} label="presets" />
          <Stat value={data && fmtInt(data.meta.limits.max_rows)} label="max rows / run" />
          <Stat value={data && `${data.meta.limits.run_time_budget_s}s`} label="time budget" />
        </div>
        {failed && <p className="lp-offline">Live catalog unavailable: the API did not respond.</p>}

        <Section id="how" kicker="how it works" title="From raw rows to an explained result in four steps">
          <ol className="lp-steps">
            {STEPS.map(([icon, title, text], i) => (
              <li key={title}>
                <div className="lp-step-top">
                  <span className="lp-step-icon"><Icon name={icon} size={18} /></span>
                  <span className="lp-step-no">0{i + 1}</span>
                </div>
                <h3>{title}</h3>
                <p>{text}</p>
              </li>
            ))}
          </ol>
        </Section>

        <Section id="features" kicker="features" title="Built like a real data platform, scaled to a playground"
          intro="Everything below is implemented in the repository, not mocked up.">
          <div className="lp-features">
            {FEATURES.map(([icon, title, text]) => (
              <article key={title} className="lp-feature">
                <span className="lp-feature-icon"><Icon name={icon} size={17} /></span>
                <h3>{title}</h3>
                <p>{text}</p>
              </article>
            ))}
          </div>
        </Section>

        <Section id="datasets" kicker="datasets" title="Seeded, deterministic, across many domains"
          intro="Same rows every run. Pick one to open it in the workbench.">
          <div className="lp-datasets">
            {data ? datasets.map((d) => (
              <a key={d.id} className={`lp-dataset ${d.faulty ? "is-faulty" : ""}`}
                {...linkTo(openConfig({ dataset_id: d.id, stages: [], output_format: "records" }))}>
                <div className="lp-dataset-top">
                  <span className="badge">{d.domain}</span>
                  {d.faulty && <span className="badge badge-warn">injected defects</span>}
                </div>
                <h3>{d.name}</h3>
                <p>{d.description}</p>
                <div className="lp-dataset-foot mono">
                  <span>{fmtInt(d.row_count)} rows</span>
                  <span>{d.schema.length} fields</span>
                  <span className="lp-open">open <Icon name="open" size={12} /></span>
                </div>
              </a>
            )) : Array.from({ length: 6 }, (_, i) => <div key={i} className="lp-dataset is-skeleton" />)}
          </div>
        </Section>

        <Section id="presets" kicker="presets" title="Start from a working pipeline"
          intro="Each preset opens in the workbench, ready to run, edit and replay.">
          <div className="lp-presets">
            {data ? data.presets.map((p) => (
              <a key={p.id} className="lp-preset" {...linkTo(openConfig(p.config))}>
                <div className="lp-preset-head">
                  <h3>{p.name}</h3>
                  <span className="mono muted">{p.config.dataset_id}</span>
                </div>
                <p>{p.description}</p>
                <ol className="lp-chain mono" aria-label="Stages">
                  {p.config.stages.map((s, i) => (
                    <li key={i} className={`kind-${s.kind}`} title={summarizeStage(s)}>{s.op}</li>
                  ))}
                </ol>
              </a>
            )) : Array.from({ length: 3 }, (_, i) => <div key={i} className="lp-preset is-skeleton" />)}
          </div>
        </Section>

        <Section id="stack" kicker="under the hood" title="Small dependency footprint, explicit limits">
          <div className="lp-stack">
            <dl className="lp-stack-list">
              {STACK.map(([k, v]) => (
                <div key={k}><dt>{k}</dt><dd>{v}</dd></div>
              ))}
            </dl>
            <pre className="lp-code" aria-label="Example pipeline config"><code>{`POST /flowbench/api/v1/runs
{
  "config": {
    "dataset_id": "iot-sensors-faulty",
    "stages": [
      { "kind": "validator", "op": "not_null",
        "params": { "fields": ["temperature_c"] } },
      { "kind": "validator", "op": "unique",
        "params": { "fields": ["reading_id"] } }
    ]
  }
}`}</code></pre>
          </div>
        </Section>

        <section className="lp-final">
          <h2>See a pipeline fail, then fix it.</h2>
          <p>The demo loads a strict ingestion pipeline onto broken sensor data and runs it.</p>
          <div className="lp-ctas">
            <a className="btn btn-run lp-cta" {...linkTo(DEMO)}><Icon name="spark" size={15} /> Run the demo</a>
            <a className="btn lp-cta" href={REPO} target="_blank" rel="noreferrer">View source <Icon name="open" size={14} /></a>
          </div>
        </section>
      </main>

      <footer className="lp-footer">
        <div className="lp-footer-brand">
          <img src="/logo.svg" width="22" height="22" alt="" />
          <span className="mono">flowbench</span>
          <span className="muted">synthetic data only · the API keeps the last 500 runs</span>
        </div>
        <CreatorMark variant="footer" />
      </footer>
    </div>
  );
}
