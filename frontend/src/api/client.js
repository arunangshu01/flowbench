// Common API prefix, same-origin in dev (Vite proxy) and prod (Firebase
// Hosting rewrite). Must match API_COMMON_PREFIX in backend/app/settings.py.
export const API_COMMON_PREFIX = "/flowbench/api/v1";
const BASE = globalThis.__FLOWBENCH_API__ ?? API_COMMON_PREFIX;

export class ApiError extends Error {
  constructor(status, message, detail) {
    super(message);
    this.status = status;
    this.detail = detail;
  }
}

async function req(path, options = {}) {
  let res;
  try {
    res = await fetch(`${BASE}${path}`, {
      headers: { "Content-Type": "application/json" },
      ...options,
    });
  } catch {
    throw new ApiError(0, "Cannot reach the Flowbench API", null);
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = body.detail;
    const message = typeof detail === "string"
      ? detail
      : detail?.message ?? `Request failed (${res.status})`;
    throw new ApiError(res.status, message, detail);
  }
  return body;
}

const post = (path, data) => req(path, { method: "POST", body: JSON.stringify(data) });

export const api = {
  health: () => req("/health"),
  meta: () => req("/meta"),
  datasets: () => req("/datasets"),
  sample: (id, n = 12) => req(`/datasets/${encodeURIComponent(id)}/sample?n=${n}`),
  registry: () => req("/registry"),
  presets: () => req("/presets"),
  validate: (config) => post("/validate", { dataset_id: config.dataset_id, stages: config.stages }),
  run: (config) => post("/runs", { config }),
  runs: () => req("/runs"),
  runDetail: (id) => req(`/runs/${encodeURIComponent(id)}`),
  replay: (id, config = null) => post(`/runs/${encodeURIComponent(id)}/replay`, { config }),
  compare: (a, b) => req(`/compare?a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}`),
  rejectsUrl: (id) => `${BASE}/runs/${encodeURIComponent(id)}/rejects.csv`,
  schedules: () => req("/schedules"),
  createSchedule: (config, interval_s) => post("/schedules", { config, interval_s }),
  deleteSchedule: (id) => req(`/schedules/${encodeURIComponent(id)}`, { method: "DELETE" }),
};

// URL-hash sharing: a pipeline config as base64url JSON.
export function encodeConfig(config) {
  try {
    const bytes = new TextEncoder().encode(JSON.stringify(config));
    let bin = "";
    bytes.forEach((b) => { bin += String.fromCharCode(b); });
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  } catch {
    return null;
  }
}

export function decodeConfig(text) {
  try {
    const b64 = text.replace(/-/g, "+").replace(/_/g, "/");
    const bin = atob(b64 + "===".slice((b64.length + 3) % 4));
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    const config = JSON.parse(new TextDecoder().decode(bytes));
    if (!config || typeof config.dataset_id !== "string" || !Array.isArray(config.stages)) return null;
    return {
      dataset_id: config.dataset_id,
      output_format: config.output_format === "csv" ? "csv" : "records",
      stages: config.stages
        .filter((s) => s && typeof s.op === "string" && (s.kind === "validator" || s.kind === "transform"))
        .map((s) => ({ kind: s.kind, op: s.op, params: s.params && typeof s.params === "object" ? s.params : {} })),
    };
  } catch {
    return null;
  }
}
