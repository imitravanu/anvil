import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { RewindRing } from "../rewindRing.js";
import type { Checkpoint } from "../checkpoints.js";
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
});
