import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import NodeInspector from "../components/NodeInspector";

const schema = [{ name: "reading_id", type: "string" }];
const stage = (index, op, rejected) => ({
  index, kind: index < 0 ? "ingest" : "validator", op, rows_in: 10, rows_out: 10 - rejected, rejected, filtered: 0,
  duration_ms: 1, errors: rejected ? [{ row: 0, rid: 0, record: {}, message: "nope" }] : [],
  sample_in: [], sample_out: [{ _rid: 1, reading_id: "r-1" }], sample_rejected: [], profile: {},
});
const config = { dataset_id: "d", output_format: "records", stages: [{ kind: "validator", op: "not_null", params: { fields: ["reading_id"] } }] };
const plan = { valid: true, input_schema: schema, output_schema: schema, stages: [{ index: 0, kind: "validator", op: "not_null", issues: [], schema }] };
const report = {
  run_id: "r1", rows_in: 10, rows_out: 9, rejected_total: 1, filtered_total: 0, warnings: [],
  stages: [stage(-1, "d", 0), stage(0, "not_null", 1)],
  output: { format: "records", sample: [{ _rid: 1, reading_id: "r-1" }], sample_size: 1 }, output_profile: {},
};
const registry = { validators: [{ name: "not_null", description: "Reject nulls.", params: [] }], transforms: [] };

test("switching from a stage's Errors tab to the sink does not crash", async () => {
  const { rerender } = render(<NodeInspector config={config} plan={plan} report={report} selected={1} registry={registry} />);
  await userEvent.click(screen.getByRole("tab", { name: /Errors/ }));
  expect(screen.getByText("nope")).toBeInTheDocument();
  rerender(<NodeInspector config={config} plan={plan} report={report} selected={2} registry={registry} />);
  expect(screen.getByRole("tab", { name: "Output" })).toHaveAttribute("aria-selected", "true");
  expect(screen.getByText("r-1")).toBeInTheDocument();
});

test("clicking a rid opens a lineage trace", async () => {
  render(<NodeInspector config={config} plan={plan} report={report} selected={1} registry={registry} />);
  await userEvent.click(screen.getByRole("tab", { name: /Errors/ }));
  await userEvent.click(screen.getByRole("button", { name: "0" }));
  expect(screen.getByRole("status")).toHaveTextContent("rejected at stage 1 (not_null)");
});
