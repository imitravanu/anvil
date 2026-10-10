import { describe, expect, it, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { saveAbResult, loadRecentAbResults, resolveEvalsDir } from "../report.js";
import type { AbResult } from "../experiment.js";

/**
 * Batch Q (F4, takeover 2026-10-10): the A/B verdict used to be console-only —
 * the only surviving record of a prompt experiment was CI stdout, and
 * `--report` could not surface it. These pin the persistence round-trip: an
 * artifact written by saveAbResult is read back by loadRecentAbResults, newest
 * first, with corrupted files skipped rather than fatal.
 */

// A minimal-but-shape-true fixture: the round-trip only needs the fields the
// loader validates plus the identity the reporter prints. Assembled as a
// partial via the runtime edge (same precedent as the team-spec typo probe):
// the loader's contract, not the experiment math, is under test here.
function fakeAb(date: string, verdict: string, significant: boolean): AbResult {
  return {
    date,
    model: "test-model",
    provider: "openai",
    trialsPerArm: 2,
    taskIds: ["task-a"],
    trials: [],
    arms: [
      { name: "baseline", passRate: 0.5, tasksSolved: 1, totalTasks: 2, avgToolCalls: 3, avgTokens: { input: 100, output: 50 }, providerErrors: 0, trials: 2 },
      { name: "candidate", passRate: 1, tasksSolved: 2, totalTasks: 2, avgToolCalls: 3, avgTokens: { input: 100, output: 50 }, providerErrors: 0, trials: 2 },
    ],
    significant,
    significance: {
      significant,
      consistentTasks: significant ? ["task-a"] : [],
      unstableTasks: significant ? [] : ["task-a"],
    },
    verdict,
  } as unknown as AbResult;
}

describe("A/B artifact persistence (Batch Q)", () => {
  let tmp: string;
  afterEach(() => {
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
    tmp = "" as unknown as string;
  });

  it("persists an AbResult beside the batch reports and reads it back, newest first", () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "anvil-ab-artifact-"));
    const saved = saveAbResult(fakeAb("2026-10-10T10:00:00.000Z", "candidate not established", false), tmp);
    expect(saved).toContain(path.join(resolveEvalsDir(tmp), "ab"));
    expect(saved).toContain("baseline-vs-candidate");

    saveAbResult(fakeAb("2026-10-10T11:00:00.000Z", "candidate wins on 3/3 tasks", true), tmp);
    const loaded = loadRecentAbResults(tmp, 5);
    expect(loaded).toHaveLength(2);
    // Newest first — the reporter reads the latest decision first.
    expect(loaded[0].date).toBe("2026-10-10T11:00:00.000Z");
    expect(loaded[0].verdict).toBe("candidate wins on 3/3 tasks");
    expect(loaded[0].significant).toBe(true);
    expect(loaded[1].significant).toBe(false);
  });

  it("skips corrupted artifacts instead of failing the report", () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "anvil-ab-corrupt-"));
    const abDir = path.join(resolveEvalsDir(tmp), "ab");
    fs.mkdirSync(abDir, { recursive: true });
    fs.writeFileSync(path.join(abDir, "0000-broken.json"), "{ not json");
    saveAbResult(fakeAb("2026-10-10T12:00:00.000Z", "clean survivor", true), tmp);
    const loaded = loadRecentAbResults(tmp, 5);
    expect(loaded).toHaveLength(1);
    expect(loaded[0].verdict).toBe("clean survivor");
  });

  it("returns empty when no artifacts exist yet", () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "anvil-ab-empty-"));
    expect(loadRecentAbResults(tmp, 5)).toEqual([]);
  });
});