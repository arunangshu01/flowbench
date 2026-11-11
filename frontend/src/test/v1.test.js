import { traceRid } from "../lib/lineage";
import { encodeConfig, decodeConfig } from "../api/client";
import { defaultParams, fitArgs, parseScalar } from "../lib/params";
import { summarizeStage } from "../lib/summary";
import { stableStringify } from "../lib/format";

const report = {
  stages: [
    { index: -1, op: "ds", errors: [], sample_out: [{ _rid: 1 }, { _rid: 42 }, { _rid: 99 }] },
    { index: 0, op: "not_null", rejected: 1, errors: [
      { row: 3, rid: 3, record: {}, message: "null value in field(s): temp" },
    ], sample_out: [{ _rid: 42 }, { _rid: 99 }] },
    { index: 1, op: "unique", rejected: 1, errors: [
      { row: 7, rid: 42, record: {}, message: "duplicate key ('r-1',)" },
    ], sample_out: [{ _rid: 99 }] },
  ],
  output: { sample: [{ _rid: 99 }] },
};

describe("traceRid", () => {
  it("finds the stage that rejected a record", () => {
    const t = traceRid(report, 42);
    expect(t.outcome).toBe("rejected");
    expect(t.at.op).toBe("unique");
    expect(t.steps.map((s) => s.status)).toEqual(["passed", "rejected"]);
  });

  it("follows survivors to the output", () => {
    const t = traceRid(report, 99);
    expect(t.outcome).toBe("output");
    expect(t.steps.every((s) => s.status === "passed")).toBe(true);
  });

  it("does not claim outcomes it cannot see", () => {
    const t = traceRid(report, 5000);
    expect(t.outcome).toBe("unknown");
    expect(t.steps.every((s) => s.status === "unsampled")).toBe(true);
  });
});

describe("config URL encoding", () => {
  it("round-trips a pipeline config, including unicode", () => {
    const cfg = {
      dataset_id: "vitals",
      output_format: "csv",
      stages: [{ kind: "transform", op: "rename", params: { mapping: { ward: "station_é" } } }],
    };
    const encoded = encodeConfig(cfg);
    expect(encoded).not.toMatch(/[+/=]/);
    expect(decodeConfig(encoded)).toEqual(cfg);
  });

  it("rejects garbage and drops malformed stages", () => {
    expect(decodeConfig("!!not-base64!!")).toBeNull();
    expect(decodeConfig(btoa('{"x":1}'))).toBeNull();
    const cleaned = decodeConfig(encodeConfig({
      dataset_id: "vitals", stages: [{ kind: "evil", op: "x" }, { kind: "validator", op: "unique", params: { fields: ["a"] } }],
    }));
    expect(cleaned.stages).toEqual([{ kind: "validator", op: "unique", params: { fields: ["a"] } }]);
    expect(cleaned.output_format).toBe("records");
  });
});

describe("param helpers", () => {
  const schema = [
    { name: "device_id", type: "string" },
    { name: "temperature_c", type: "float" },
  ];
  const op = (name, params = []) => ({ name, params });

  it("picks type-appropriate defaults", () => {
    expect(defaultParams(op("range"), schema)).toEqual({ field: "temperature_c", min: 0 });
    expect(defaultParams(op("upper"), schema)).toEqual({ field: "device_id" });
    expect(defaultParams(op("join_lookup"), schema)).toMatchObject({ on: "device_id", table: "devices" });
  });

  it("parses scalars", () => {
    expect(parseScalar("42")).toBe(42);
    expect(parseScalar("-1.5")).toBe(-1.5);
    expect(parseScalar("true")).toBe(true);
    expect(parseScalar("plant-north")).toBe("plant-north");
  });

  it("fits derive args to arity", () => {
    expect(fitArgs([{ field: "a" }, 2], 1, schema)).toEqual([{ field: "a" }]);
    expect(fitArgs([{ field: "a" }], 2, schema)).toEqual([{ field: "a" }, 1]);
  });

  it("summarizes stages readably", () => {
    expect(summarizeStage({ op: "range", params: { field: "h", min: 0 } })).toBe("h in [0, ∞]");
    expect(summarizeStage({ op: "join_lookup", params: { on: "ward", table: "wards" } })).toBe("left join wards on ward");
  });

  it("stable-stringifies regardless of key order", () => {
    expect(stableStringify({ b: 1, a: [{ y: 1, x: 2 }] })).toBe(stableStringify({ a: [{ x: 2, y: 1 }], b: 1 }));
  });
});
