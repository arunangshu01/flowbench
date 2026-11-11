import { initialPipeline, pipelineReducer } from "../state/pipeline";

const base = {
  ...initialPipeline,
  stages: [
    { kind: "validator", op: "a", params: { x: 1 } },
    { kind: "transform", op: "b", params: {} },
  ],
};

describe("pipelineReducer", () => {
  it("adds at an index with params, and removes", () => {
    let s = pipelineReducer(base, { type: "add_stage", kind: "validator", op: "unique", index: 1, params: { fields: ["k"] } });
    expect(s.stages.map((x) => x.op)).toEqual(["a", "unique", "b"]);
    expect(s.stages[1].params).toEqual({ fields: ["k"] });
    s = pipelineReducer(s, { type: "remove_stage", index: 1 });
    expect(s.stages.map((x) => x.op)).toEqual(["a", "b"]);
  });

  it("caps the pipeline at 20 stages", () => {
    let s = { ...base, stages: [] };
    for (let i = 0; i < 25; i += 1) s = pipelineReducer(s, { type: "add_stage", kind: "transform", op: "upper" });
    expect(s.stages).toHaveLength(20);
  });

  it("set_stage_op replaces params", () => {
    const s = pipelineReducer(base, { type: "set_stage_op", index: 0, op: "range", params: { field: "f", min: 0 } });
    expect(s.stages[0]).toEqual({ kind: "validator", op: "range", params: { field: "f", min: 0 } });
  });

  it("set_param sets and clears a single param", () => {
    let s = pipelineReducer(base, { type: "set_param", index: 0, name: "y", value: 2 });
    expect(s.stages[0].params).toEqual({ x: 1, y: 2 });
    s = pipelineReducer(s, { type: "set_param", index: 0, name: "x", value: undefined });
    expect(s.stages[0].params).toEqual({ y: 2 });
  });

  it("duplicates a stage as a deep copy", () => {
    const s = pipelineReducer(base, { type: "duplicate_stage", index: 0 });
    expect(s.stages.map((x) => x.op)).toEqual(["a", "a", "b"]);
    expect(s.stages[1].params).not.toBe(s.stages[0].params);
  });

  it("moves stages, respecting bounds", () => {
    expect(pipelineReducer(base, { type: "move_stage", index: 1, dir: -1 }).stages.map((x) => x.op)).toEqual(["b", "a"]);
    expect(pipelineReducer(base, { type: "move_stage", index: 0, dir: -1 })).toBe(base);
  });

  it("loads configs defensively and clears stages", () => {
    const s = pipelineReducer(base, { type: "load_config", config: { dataset_id: "vitals", stages: [{ kind: "transform", op: "upper" }] } });
    expect(s).toEqual({ dataset_id: "vitals", output_format: "records", stages: [{ kind: "transform", op: "upper", params: {} }] });
    expect(pipelineReducer(s, { type: "clear_stages" }).stages).toEqual([]);
  });
});
