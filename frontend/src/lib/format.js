export const fmtInt = (n) => (n ?? 0).toLocaleString("en-US");

export function fmtMs(ms) {
  if (ms == null) return "-";
  if (ms < 1) return `${ms.toFixed(2)} ms`;
  if (ms < 1000) return `${ms < 10 ? ms.toFixed(1) : Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

export function fmtPct(part, whole) {
  if (!whole) return "0%";
  const p = (100 * part) / whole;
  return `${p >= 10 || p === 0 ? Math.round(p) : p.toFixed(1)}%`;
}

export function relTime(iso, now = Date.now()) {
  if (!iso) return "-";
  const s = Math.round((now - new Date(iso).getTime()) / 1000);
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(iso).toLocaleDateString();
}

export function fmtDuration(totalSeconds) {
  const s = Math.max(0, Math.round(totalSeconds));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

export const shortId = (id) => (id ? id.slice(0, 8) : "");

// Stable stringify (sorted keys) for comparing configs.
export function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
