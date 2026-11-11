import React from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "../App";
import { API_COMMON_PREFIX, encodeConfig } from "../api/client";

const schema = [
  { name: "reading_id", type: "string", description: "" },
  { name: "temperature_c", type: "float", description: "" },
  { name: "humidity_pct", type: "float", description: "" },
];
const p = (name, type, extra = {}) => ({ name, type, required: true, description: "", ...extra });
const REGISTRY = {
  validators: [
    { name: "not_null", kind: "validator", category: "completeness", description: "Reject nulls.", params: [p("fields", "fields")] },
    { name: "range", kind: "validator", category: "accuracy", description: "Range check.", params: [p("field", "field"), p("min", "number", { required: false }), p("max", "number", { required: false })] },
    { name: "unique", kind: "validator", category: "uniqueness", description: "Unique key.", params: [p("fields", "fields")] },
  ],
  transforms: [{ name: "upper", kind: "transform", category: "clean", description: "Upper.", params: [p("field", "field")] }],
  fn_arity: {},
};

function stageReport(i, op, rows_in, rejected) {
  return {
    index: i, kind: "validator", op, rows_in, rows_out: rows_in - rejected, rejected, filtered: 0, duration_ms: 0.4,
    errors: rejected ? [{ row: 1, rid: 1, record: {}, message: `${op} says no` }] : [],
    sample_in: [], sample_out: [{ _rid: 2, reading_id: "r-2" }], sample_rejected: [], profile: {},
  };
}

function planFor(body) {
  const stages = body.stages.map((s, i) => ({ index: i, kind: s.kind, op: s.op, schema, issues:
    s.params.field === "missing" ? [{ level: "error", message: "field 'missing' does not exist at this stage" }] : [] }));
  return { valid: stages.every((s) => !s.issues.length), input_schema: schema, output_schema: schema, stages };
}

const runButton = () => within(document.querySelector(".topbar")).getByRole("button", { name: /^Run/ });

let runCalls;
beforeEach(() => {
  runCalls = [];
  window.location.hash = "";
  global.fetch = jest.fn(async (url, opts = {}) => {
    const path = url.replace(API_COMMON_PREFIX, "").split("?")[0];
    const body = opts.body ? JSON.parse(opts.body) : null;
    const ok = (data, status = 200) => ({ ok: status < 400, status, json: async () => data });
    if (path === "/datasets") return ok([{ id: "iot-sensors-faulty", name: "IoT (faulty)", domain: "iot", faulty: true, description: "d", row_count: 2000, schema }]);
    if (path === "/registry") return ok(REGISTRY);
    if (path === "/presets") return ok([]);
    if (path === "/meta") return ok({ version: "0.2.0", limits: { max_rows: 10000, runs_per_minute: 10, run_time_budget_s: 10, max_schedules: 5 } });
    if (path === "/runs" && opts.method === "POST") {
      runCalls.push(body.config);
      const st = body.config.stages.map((s, i) => stageReport(i, s.op, 2000, i === 0 ? 76 : 0));
      return ok({
        run_id: "abc123def456", dataset_id: body.config.dataset_id, status: "success", trigger: "manual",
        replayed_from: null, duration_ms: 12, rows_in: 2000, rows_out: 1924, rejected_total: 76, filtered_total: 0,
        input_schema: schema, output_schema: schema, output_profile: {}, warnings: [],
        stages: [{ ...stageReport(-1, "iot-sensors-faulty", 2000, 0), kind: "ingest" }, ...st],
        output: { format: "records", sample: [{ _rid: 2, reading_id: "r-2" }], sample_size: 1 },
        config: body.config,
      }, 201);
    }
    if (path === "/runs") return ok([]);
    if (path === "/schedules") return ok([]);
    if (path === "/validate") return ok(planFor(body));
    if (path === "/health") return ok({ status: "ok" });
    return ok({ detail: "not found" }, 404);
  });
});

test("renders the workbench, runs the pipeline, and lands on the rejecting stage", async () => {
  render(<App />);
  expect(await screen.findByText("Build a pipeline, run it, then inspect every stage.")).toBeInTheDocument();
  await waitFor(() => expect(runButton()).toBeEnabled());

  await userEvent.click(runButton());
  expect(await screen.findByText(/Run abc123de finished/)).toBeInTheDocument();
  expect(runCalls).toHaveLength(1);

  // inspector auto-selects the first stage with rejections
  const inspector = screen.getByRole("region", { name: "Node inspector" });
  expect(within(inspector).getByRole("heading", { name: "not_null" })).toBeInTheDocument();
  expect(within(inspector).getByRole("tab", { name: /Errors/ })).toBeInTheDocument();
  expect(within(document.querySelector(".statusbar")).getByText("Arunangshu Pramanik")).toBeInTheDocument();
});

test("planner errors from a shared link block running and show on the stage", async () => {
  window.location.hash = `#config=${encodeConfig({
    dataset_id: "iot-sensors-faulty",
    output_format: "records",
    stages: [{ kind: "validator", op: "range", params: { field: "missing", min: 0 } }],
  })}`;
  render(<App />);
  const msgs = await screen.findAllByText("field 'missing' does not exist at this stage");
  expect(msgs.length).toBeGreaterThan(0);
  expect(runButton()).toBeDisabled();
  expect(screen.getByText("plan: 1 error")).toBeInTheDocument();
  expect(screen.getByRole("option", { name: "missing (not available here)" })).toBeInTheDocument();
  expect(runCalls).toHaveLength(0);
});

test("adds a stage from the menu with schema-aware defaults", async () => {
  render(<App />);
  await screen.findByText("Build a pipeline, run it, then inspect every stage.");
  await waitFor(() => expect(screen.getByRole("button", { name: /Add stage/ })).toBeInTheDocument());
  await userEvent.click(screen.getByRole("button", { name: /Add stage/ }));
  await userEvent.click(screen.getByRole("menuitem", { name: /upper/ }));
  await waitFor(() => {
    const lastValidate = global.fetch.mock.calls.filter(([u]) => u.endsWith("/validate")).at(-1);
    const stages = JSON.parse(lastValidate[1].body).stages;
    expect(stages.at(-1)).toEqual({ kind: "transform", op: "upper", params: { field: "reading_id" } });
  });
});
