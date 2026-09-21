import { EvalReport } from "./types.js";

/**
 * A report where the provider was never meaningfully reached is not a model
 * measurement: all-429 free-tier lanes, dead keys, network outages. Such a run
 * must not enter the delta pairing — an all-429 "0%" ON lane would render as
 * "the guardian destroyed the pass rate", manufacturing a result out of an
 * outage. Aliveness threshold: at least HALF the tasks spent tokens (a real
 * exchange with the provider).
 */
function isPairable(report: EvalReport): boolean {
  if (report.results.length === 0) return false;
  const alive = report.results.filter(
    (r) => r.tokensUsed.input > 0 || r.tokensUsed.output > 0
  ).length;
  return alive * 2 >= report.results.length;
}

/** The task-id set both halves of a pair must cover — same tasks, same seed. */
function taskIdSet(report: EvalReport): string {
  return report.results.map((r) => r.taskId).sort().join(",");
}

/**
 * Guardian delta pairing (26.3): find the most recent ON/OFF report pair for a
 * model/provider combination. Only reports with a recorded `guardian` field are
 * eligible (legacy reports default to ON in their rendering but carry no field,
 * so they cannot be paired safely), and only "alive" ones (see isAliveReport).
 */
export function findGuardianDeltaPair(
  reports: EvalReport[],
  opts: { provider?: string; model?: string } = {}
): { on: EvalReport | undefined; off: EvalReport | undefined } {
  const eligible = reports.filter(
    (r) =>
      typeof r.guardian === "boolean" &&
      isPairable(r) &&
      (opts.provider ? r.provider === opts.provider : true) &&
      (opts.model ? r.model === opts.model : true)
  );
  // Newest first (loadRecentReports already sorts that way, but do not rely on it).
  eligible.sort((a, b) => b.timestamp - a.timestamp);
  const off = eligible.find((r) => r.guardian === false);
  if (!off) return { on: undefined, off: undefined };
  // The ON half must cover the SAME task set as the OFF half — a 1-task probe
  // against a 15-task run is not a delta, it is a mismatched comparison.
  const offSet = taskIdSet(off);
  const on = eligible.find(
    (r) => r.guardian === true && taskIdSet(r) === offSet
  );
  return { on, off };
}
