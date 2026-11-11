import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { api, decodeConfig, downloadText, encodeConfig, sanitizeConfig } from "./api/client";
import { initialPipeline, pipelineReducer } from "./state/pipeline";
import { shortId, stableStringify, fmtInt } from "./lib/format";
import TopBar from "./components/TopBar";
import PipelineRail from "./components/PipelineRail";
import DagCanvas from "./components/DagCanvas";
import RunSummary from "./components/RunSummary";
import NodeInspector from "./components/NodeInspector";
import EmptyState from "./components/EmptyState";
import HistoryView from "./components/HistoryView";
import SchedulesView from "./components/SchedulesView";
import StatusBar from "./components/StatusBar";
import CreatorMark from "./components/CreatorMark";
import Toasts from "./components/Toasts";
import { DEMO_PRESET } from "./lib/content";
import "./styles.css";

const EMPTY_REGISTRY = { validators: [], transforms: [], fn_arity: {} };

function loadInitialConfig() {
  const m = window.location.hash.match(/^#config=(.+)$/);
  return (m && decodeConfig(m[1])) || initialPipeline;
}

const opSequence = (cfg) => cfg.stages.map((s) => `${s.kind}:${s.op}`).join("|");

// After a run, land on the first stage that rejected rows (else the sink).
function landingNode(report) {
  const i = report.stages.findIndex((s, k) => k > 0 && s.rejected > 0);
  return i > 0 ? i : report.stages.length;
}

export default function App() {
  const [datasets, setDatasets] = useState([]);
  const [registry, setRegistry] = useState(EMPTY_REGISTRY);
  const [presets, setPresets] = useState([]);
  const [meta, setMeta] = useState(null);
  const [apiOk, setApiOk] = useState(true);
  const [config, dispatch] = useReducer(pipelineReducer, undefined, loadInitialConfig);
  const [plan, setPlan] = useState(null);
  const [planPending, setPlanPending] = useState(true);
  const [report, setReport] = useState(null);
  const [runs, setRuns] = useState([]);
  const [schedules, setSchedules] = useState([]);
  const [selected, setSelected] = useState(0);
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState("inspect");
  const [toasts, setToasts] = useState([]);
  const [now, setNow] = useState(Date.now());
  const planSeq = useRef(0);

  const toast = useCallback((tone, title, text) => {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => [...t.slice(-3), { id, tone, title, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === "error" ? 7000 : 4000);
  }, []);
  const onError = useCallback((e) => toast("error", e.message), [toast]);

  const refresh = useCallback(() => {
    api.runs().then(setRuns).catch(() => {});
    api.schedules().then(setSchedules).catch(() => {});
  }, []);

  // bootstrap
  useEffect(() => {
    Promise.all([api.datasets(), api.registry(), api.presets(), api.meta()])
      .then(([d, r, p, m]) => { setDatasets(d); setRegistry(r); setPresets(p); setMeta(m); setApiOk(true); })
      .catch((e) => { setApiOk(false); onError(e); });
    refresh();
  }, [refresh, onError]);

  // health + background refresh (faster while something is scheduled or being watched)
  const watching = schedules.length > 0 || view === "history" || view === "schedules";
  useEffect(() => {
    const id = setInterval(() => {
      api.health().then(() => setApiOk(true)).catch(() => setApiOk(false));
      if (watching) refresh();
    }, watching ? 5000 : 15000);
    return () => clearInterval(id);
  }, [watching, refresh]);

  // clock for relative times / countdowns
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), view === "schedules" ? 1000 : 15000);
    return () => clearInterval(id);
  }, [view]);

  // live planning (debounced) whenever the pipeline changes
  const configKey = stableStringify(config);
  useEffect(() => {
    setPlanPending(true);
    const seq = ++planSeq.current;
    const t = setTimeout(() => {
      api.validate(config)
        .then((p) => { if (seq === planSeq.current) setPlan(p); })
        .catch(() => {})
        .finally(() => { if (seq === planSeq.current) setPlanPending(false); });
    }, 220);
    return () => clearTimeout(t);
  }, [configKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // shareable URL
  useEffect(() => {
    const encoded = encodeConfig(config);
    if (encoded) window.history.replaceState(null, "", `#config=${encoded}`);
  }, [configKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // keep the selected node in range as stages are added/removed
  useEffect(() => {
    setSelected((s) => Math.min(s, config.stages.length + 1));
  }, [config.stages.length]);

  const fresh = !!report && stableStringify(report.config) === configKey;
  const compatible = !!report && report.dataset_id === config.dataset_id
    && opSequence(report.config) === opSequence(config);
  const viewReport = compatible ? report : null;
  const planErrors = plan ? !plan.valid : false;

  const finishRun = useCallback((rep, verb) => {
    setReport(rep);
    dispatch({ type: "load_config", config: rep.config });
    setSelected(landingNode(rep));
    setView((v) => (v === "build" || v === "history" ? "inspect" : v));
    refresh();
    toast("success", `${verb} ${shortId(rep.run_id)} finished`,
      `${fmtInt(rep.rows_out)} of ${fmtInt(rep.rows_in)} rows out · ${fmtInt(rep.rejected_total)} rejected`);
  }, [refresh, toast]);

  const handleRunError = useCallback((e) => {
    if (e.status === 422 && e.detail?.plan) {
      setPlan(e.detail.plan);
      setView("build");
      toast("error", "Pipeline has configuration errors", "Fix the highlighted stages and run again.");
    } else {
      onError(e);
    }
  }, [onError, toast]);

  const execute = useCallback(async (cfg = config) => {
    if (busy) return;
    setBusy(true);
    try {
      finishRun(await api.run(cfg), "Run");
    } catch (e) {
      handleRunError(e);
    } finally {
      setBusy(false);
    }
  }, [busy, config, finishRun, handleRunError]);

  const replay = useCallback(async (runId, cfg = null) => {
    if (busy) return;
    setBusy(true);
    try {
      finishRun(await api.replay(runId, cfg), "Replay");
    } catch (e) {
      handleRunError(e);
    } finally {
      setBusy(false);
    }
  }, [busy, finishRun, handleRunError]);

  const openRun = useCallback(async (id) => {
    try {
      const rep = await api.runDetail(id);
      setReport(rep);
      dispatch({ type: "load_config", config: rep.config });
      setSelected(landingNode(rep));
      setView("inspect");
    } catch (e) {
      onError(e);
    }
  }, [onError]);

  const loadPreset = useCallback((p) => {
    dispatch({ type: "load_config", config: p.config });
    setReport(null);
    setSelected(0);
    toast("info", `Loaded “${p.name}”`, "Press Run to execute it.");
  }, [toast]);

  const runPreset = useCallback((id) => {
    const p = presets.find((x) => x.id === id);
    if (!p) return;
    dispatch({ type: "load_config", config: p.config });
    execute(p.config);
  }, [presets, execute]);
  const runDemo = useCallback(() => runPreset(DEMO_PRESET), [runPreset]);

  // Landing-page deep link: /app?demo=<preset id> loads and runs that preset once.
  const demoHandled = useRef(false);
  useEffect(() => {
    const demo = new URLSearchParams(window.location.search).get("demo");
    if (!demo || demoHandled.current || !presets.length) return;
    demoHandled.current = true;
    window.history.replaceState(null, "", window.location.pathname + window.location.hash);
    runPreset(demo);
  }, [presets, runPreset]);

  const exportPipeline = useCallback(() => {
    const doc = { flowbench: 1, exported_at: new Date().toISOString(), config };
    downloadText(`flowbench-pipeline-${config.dataset_id}.json`, `${JSON.stringify(doc, null, 2)}\n`, "application/json");
  }, [config]);

  const importPipeline = useCallback(async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      if (file.size > 64 * 1024) throw new Error("file is larger than 64 KB");
      const parsed = JSON.parse(await file.text());
      const cfg = sanitizeConfig(parsed?.config ?? parsed);
      if (!cfg) throw new Error("not a Flowbench pipeline");
      dispatch({ type: "load_config", config: cfg });
      setReport(null);
      setSelected(0);
      toast("success", `Imported ${file.name}`, `${cfg.stages.length} stage(s) on ${cfg.dataset_id}. It is checked before it can run.`);
    } catch (err) {
      toast("error", "Could not import pipeline", err.message);
    }
  }, [toast]);

  const share = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      toast("success", "Link copied", "Anyone with the link opens this exact pipeline.");
    } catch {
      toast("info", "Copy the URL from the address bar", "It encodes the current pipeline.");
    }
  }, [toast]);

  const createSchedule = useCallback(async (interval) => {
    try {
      await api.createSchedule(config, interval);
      refresh();
      toast("success", "Schedule created", "The first run happens within a few seconds.");
    } catch (e) {
      onError(e);
    }
  }, [config, refresh, toast, onError]);

  const deleteSchedule = useCallback(async (id) => {
    try {
      await api.deleteSchedule(id);
      refresh();
    } catch (e) {
      onError(e);
    }
  }, [refresh, onError]);

  // ⌘/Ctrl + Enter runs from anywhere
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && !planErrors) {
        e.preventDefault();
        execute();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [execute, planErrors]);

  const planState = planErrors ? "error" : "ok";
  const workbench = view === "inspect" || view === "build";

  const legend = useMemo(() => (
    <div className="legend">
      {[["ingest", "source"], ["validator", "validator"], ["transform", "transform"], ["output", "sink"]].map(([k, l]) => (
        <span key={k} className={`legend-item kind-${k}`}><i />{l}</span>
      ))}
      <span className="legend-item is-rejected"><i />rejected</span>
      <span className="legend-item is-filtered"><i />filtered</span>
    </div>
  ), []);

  return (
    <div className="app" data-view={view}>
      <TopBar view={view} onView={setView} presets={presets} onPreset={loadPreset}
        onShare={share} onRun={() => execute()} busy={busy} planState={planState} />

      <div className="shell">
        <aside className="rail-pane" aria-label="Pipeline builder">
          <div className="pane-head">
            <span className="kicker">pipeline</span>
            <div className="pane-actions">
              <button type="button" className="link-btn" onClick={exportPipeline} title="Download this pipeline as JSON">export</button>
              <label className="link-btn" title="Load a pipeline JSON file">
                import
                <input type="file" accept="application/json,.json" className="sr-only" onChange={importPipeline} />
              </label>
              {config.stages.length > 0 && (
                <button type="button" className="link-btn" onClick={() => dispatch({ type: "clear_stages" })}>clear</button>
              )}
            </div>
          </div>
          <PipelineRail config={config} dispatch={dispatch} datasets={datasets} registry={registry}
            plan={plan} freshReport={fresh ? report : null} selected={selected}
            onSelect={(i) => setSelected(i)} />
          <div className="mobile-only mobile-run">
            <button type="button" className="btn btn-run btn-block" disabled={busy || planErrors} onClick={() => execute()}>
              {busy ? "Running…" : planErrors ? "Fix errors to run" : "Run pipeline"}
            </button>
          </div>
          <CreatorMark variant="card" />
        </aside>

        <main className="main-pane" id="main">
          {workbench && (
            <div className="view">
              <section className="panel dag-panel" aria-label="Pipeline graph">
                <header className="panel-head">
                  <div>
                    <span className="kicker">pipeline graph</span>
                    <h2 className="mono">{config.dataset_id} <span className="muted">· {config.stages.length} stage{config.stages.length === 1 ? "" : "s"}</span></h2>
                  </div>
                  {legend}
                </header>
                <DagCanvas config={config} plan={plan} report={viewReport} selected={selected}
                  onSelect={setSelected} running={busy} />
                {report && (
                  <RunSummary report={report} stale={!fresh} busy={busy}
                    onReplayStored={() => replay(report.run_id)}
                    onReplayCurrent={() => replay(report.run_id, config)}
                    onLoadParent={openRun} />
                )}
                {report && !compatible && (
                  <p className="footnote">The pipeline's stages changed since run {shortId(report.run_id)}; the graph shows the plan. Run or replay with edits to see new results.</p>
                )}
              </section>

              {!report && (
                <EmptyState onDemo={runDemo} onRun={() => execute()} canRun={!planErrors} busy={busy} />
              )}

              <NodeInspector config={config} plan={plan} report={viewReport} selected={selected} registry={registry} />
            </div>
          )}

          {view === "history" && (
            <HistoryView runs={runs} now={now} busy={busy} activeRunId={report?.run_id}
              onOpen={openRun} onReplay={(id) => replay(id)} onError={onError} />
          )}

          {view === "schedules" && (
            <SchedulesView schedules={schedules} config={config} planValid={!planErrors} now={now}
              maxSchedules={meta?.limits?.max_schedules ?? 5}
              onCreate={createSchedule} onDelete={deleteSchedule}
              onLoad={(cfg) => { dispatch({ type: "load_config", config: cfg }); setReport(null); setView("inspect"); }} />
          )}

          <CreatorMark variant="card" />
        </main>
      </div>

      <StatusBar apiOk={apiOk} plan={plan} planPending={planPending} meta={meta} />
      <Toasts toasts={toasts} onDismiss={(id) => setToasts((t) => t.filter((x) => x.id !== id))} />
    </div>
  );
}
