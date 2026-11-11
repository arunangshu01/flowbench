/**
 * Trace a lineage id (_rid) through a run report using what the report
 * actually recorded: per-stage error lists (capped by the engine) and
 * per-stage output samples (first N rows). Each step is:
 *
 *   "passed"    rid is in that stage's output sample
 *   "rejected"  rid is in that stage's recorded errors (trace stops)
 *   "unsampled" not visible in the recorded samples - no claim either way
 */
export function traceRid(report, rid) {
  const steps = [];
  for (const stage of report.stages.slice(1)) {
    const err = (stage.errors ?? []).find((e) => e.rid === rid);
    if (err) {
      steps.push({ stage, status: "rejected", message: err.message });
      return { rid, outcome: "rejected", steps, at: stage, message: err.message };
    }
    const passed = (stage.sample_out ?? []).some((r) => r._rid === rid);
    steps.push({ stage, status: passed ? "passed" : "unsampled" });
  }
  const inOutput = (report.output?.sample ?? []).some((r) => r._rid === rid);
  return { rid, outcome: inOutput ? "output" : "unknown", steps };
}
