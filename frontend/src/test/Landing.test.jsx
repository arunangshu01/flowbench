import React from "react";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Root from "../Root";
import { API_COMMON_PREFIX, decodeConfig } from "../api/client";

const schema = [{ name: "id", type: "string", description: "" }];
const DATA = {
  "/health": { status: "ok" },
  "/meta": { version: "0.2.0", limits: { max_rows: 10000, run_time_budget_s: 10, runs_per_minute: 10, max_schedules: 5 } },
  "/datasets": [
    { id: "orders", name: "E-commerce Orders", domain: "retail", faulty: false, description: "orders", row_count: 1800, schema },
    { id: "orders-faulty", name: "E-commerce Orders (faulty)", domain: "retail", faulty: true, description: "broken", row_count: 1800, schema },
    { id: "flights", name: "Flight Departures", domain: "aviation", faulty: false, description: "flights", row_count: 1500, schema },
  ],
  "/registry": {
    validators: [
      { name: "not_null", kind: "validator", category: "completeness", description: "d", params: [{ name: "fields", type: "fields", required: true }] },
      { name: "range", kind: "validator", category: "accuracy", description: "d", params: [{ name: "field", type: "field", required: true }] },
    ],
    transforms: [{ name: "upper", kind: "transform", category: "clean", description: "d", params: [{ name: "field", type: "field", required: true }] }],
    fn_arity: {},
  },
  "/presets": [{ id: "p1", name: "Preset one", description: "desc", config: {
    dataset_id: "orders", output_format: "records", stages: [{ kind: "validator", op: "not_null", params: { fields: ["id"] } }] } }],
  "/runs": [], "/schedules": [],
};

function mockApi(fail = false) {
  global.fetch = jest.fn(async (url) => {
    const path = url.replace(API_COMMON_PREFIX, "").split("?")[0];
    if (fail) throw new TypeError("network down");
    if (path === "/validate") return { ok: true, status: 200, json: async () => ({ valid: true, input_schema: schema, output_schema: schema, stages: [] }) };
    return { ok: path in DATA, status: path in DATA ? 200 : 404, json: async () => DATA[path] ?? { detail: "nf" } };
  });
}

beforeEach(() => window.history.replaceState(null, "", "/"));

test("landing boot sequence reports real API results and fills the catalog", async () => {
  mockApi();
  render(<Root />);
  expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Build a pipeline. Break it. Inspect every row.");

  expect(await screen.findByText("ready")).toBeInTheDocument();
  const log = screen.getByRole("log", { name: "Boot sequence" });
  expect(within(log).getByText("3 datasets · 2 domains")).toBeInTheDocument();
  expect(within(log).getByText("2 validators · 1 transforms")).toBeInTheDocument();

  const stats = screen.getByLabelText("Live catalog");
  expect(within(stats).getByText("operations").previousSibling).toHaveTextContent("3");

  const faulty = screen.getByRole("link", { name: /E-commerce Orders \(faulty\)/ });
  expect(decodeConfig(faulty.getAttribute("href").split("#config=")[1]).dataset_id).toBe("orders-faulty");
  expect(screen.getByRole("link", { name: /Preset one/ }).getAttribute("href")).toMatch(/^\/app#config=/);
  expect(screen.getAllByRole("link", { name: /Run the faulty-data demo|Run the demo/ })[0])
    .toHaveAttribute("href", "/app?demo=strict-sensor-ingest");
  expect(within(document.querySelector(".lp-footer")).getByText("Arunangshu Pramanik")).toBeInTheDocument();
});

test("boot failure is reported honestly", async () => {
  mockApi(true);
  render(<Root />);
  expect(await screen.findByText(/Backend unreachable/)).toBeInTheDocument();
  expect(screen.getByText("Cannot reach the Flowbench API")).toBeInTheDocument();
  expect(screen.getByText(/Live catalog unavailable/)).toBeInTheDocument();
});

test("launch navigates client-side to the workbench and the brand goes back", async () => {
  mockApi();
  render(<Root />);
  await screen.findByText("ready");
  await userEvent.click(screen.getAllByRole("link", { name: /Launch workbench/ })[0]);
  expect(window.location.pathname).toBe("/app");
  expect(await screen.findByRole("region", { name: "Pipeline graph" })).toBeInTheDocument();

  await userEvent.click(within(document.querySelector(".topbar")).getByRole("link", { name: "Flowbench home" }));
  expect(window.location.pathname).toBe("/");
  expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
});

test("legacy share links (/#config=...) open the workbench", async () => {
  mockApi();
  window.history.replaceState(null, "", "/#config=abc");
  await act(async () => { render(<Root />); });
  expect(window.location.pathname).toBe("/app");
  expect(await screen.findByRole("region", { name: "Pipeline graph" })).toBeInTheDocument();
});
