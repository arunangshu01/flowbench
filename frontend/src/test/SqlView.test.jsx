import React from "react";
import { render, screen } from "@testing-library/react";
import SqlView from "../components/SqlView";
import { sanitizeConfig } from "../api/client";

const config = { dataset_id: "vitals", output_format: "records", stages: [] };

test("shows compiled SQL, notes and download links", async () => {
  global.fetch = jest.fn(async () => ({
    ok: true, status: 200,
    json: async () => ({ dialect: "duckdb", sql: "WITH source AS (SELECT 1)\nSELECT * FROM source;", setup_sql: "CREATE TABLE vitals (x INT);", notes: ["a semantic note"] }),
  }));
  render(<SqlView config={config} planValid />);
  expect(await screen.findByLabelText("Compiled SQL")).toHaveTextContent("WITH source AS");
  expect(screen.getByText("a semantic note")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /vitals\.csv/ })).toHaveAttribute("href", "/flowbench/api/v1/datasets/vitals/download.csv");
  expect(global.fetch.mock.calls[0][0]).toBe("/flowbench/api/v1/compile/sql");
});

test("does not request SQL for an invalid pipeline", () => {
  global.fetch = jest.fn();
  render(<SqlView config={config} planValid={false} />);
  expect(screen.getByText(/Fix the pipeline's errors/)).toBeInTheDocument();
  expect(global.fetch).not.toHaveBeenCalled();
});

test("imported files are sanitized like share links", () => {
  expect(sanitizeConfig({ nope: true })).toBeNull();
  const cfg = sanitizeConfig({
    dataset_id: "orders", output_format: "xml",
    stages: [{ kind: "validator", op: "unique", params: ["bad"] }, { kind: "shell", op: "rm" }],
  });
  expect(cfg).toEqual({ dataset_id: "orders", output_format: "records", stages: [{ kind: "validator", op: "unique", params: {} }] });
  expect(sanitizeConfig({ dataset_id: "x", stages: Array.from({ length: 30 }, () => ({ kind: "transform", op: "upper" })) }).stages).toHaveLength(20);
});
