import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { RewindRing } from "../rewindRing.js";
import { CHECKPOINT_KEEP, type Checkpoint } from "../checkpoints.js";
import { BASELINE_MAX_PATHS } from "../../config/constants.js";

// The review baseline moved out of AgentSession into RewindRing; the bound is
// a ring concern and is tested here, against the module directly.
describe("RewindRing review baseline bounds", () => {
  it("evicts oldest-seen paths once over cap, newest survive", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "anvil-baseline-"));
    try {
      const ring = new RewindRing({
        projectRoot: tmp,
        sessionId: `baseline-${process.pid}-${Date.now()}`,
        recordLedger: () => {},
      });
      const files = Array.from({ length: BASELINE_MAX_PATHS + 10 }, (_, i) => ({
        path: `f${i}.txt`,
        content: Buffer.from("x"),
      }));
      // Private seams: bracket access is the repo's established test escape for
      // reaching a class's internals without widening its public API.
      ring["recordBaseline"]({ id: 1, ts: "", files, skipped: 0 } as Checkpoint);
      const baseline = ring["baselineByPath"] as Map<string, Buffer | null>;
      expect(baseline.size).toBeLessThanOrEqual(BASELINE_MAX_PATHS);
      expect(baseline.has("f0.txt")).toBe(false); // oldest evicted first
      expect(baseline.has(`f${BASELINE_MAX_PATHS + 9}.txt`)).toBe(true);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("counts baseline and ring-cap evictions for coverage honesty", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "anvil-cov-"));
    const prevHome = process.env.ANVIL_HOME;
    process.env.ANVIL_HOME = tmp; // merge persists; keep it in the temp dir
    try {
      const ring = new RewindRing({
        projectRoot: tmp,
        sessionId: `cov-${process.pid}-${Date.now()}`,
        recordLedger: () => {},
      });
      const files = Array.from({ length: BASELINE_MAX_PATHS + 2 }, (_, i) => ({
        path: `f${i}.txt`,
        content: Buffer.from("x"),
      }));
      ring["recordBaseline"]({ id: 1, ts: "", files, skipped: 0 } as Checkpoint);
      expect(ring.baselineDroppedPaths).toBeGreaterThan(0);

      const one = (id: number): Checkpoint => ({
        id,
        ts: "",
        files: [{ path: `c${id}.txt`, content: Buffer.from("y") }],
        skipped: 0,
      });
      for (let i = 1; i <= CHECKPOINT_KEEP + 2; i++) await ring.merge([one(i)]);
      expect(ring.ringDroppedCheckpoints).toBeGreaterThan(0);
    } finally {
      if (prevHome === undefined) delete process.env.ANVIL_HOME;
      else process.env.ANVIL_HOME = prevHome;
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
