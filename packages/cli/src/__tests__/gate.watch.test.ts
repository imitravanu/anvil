import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  createDebouncer,
  formatWatchBanner,
  scanWorkingTree,
  watchTransitionMessage,
  type WorkingTreeScan,
} from "../gate.js";

describe("formatWatchBanner", () => {
  it("states the diff-vs-HEAD scope honestly", () => {
    const banner = formatWatchBanner("/tmp/proj");
    expect(banner).toContain("/tmp/proj");
    expect(banner).toContain("working-tree diff vs HEAD");
    expect(banner).toContain("NOT full-tree coverage");
  });
});

describe("watchTransitionMessage", () => {
  it("stays silent on a clean tree that was already clean", () => {
    expect(watchTransitionMessage(0, { violations: [] })).toBeNull();
  });

  it("reports recovery after violations clear", () => {
    expect(watchTransitionMessage(2, { violations: [] })).toMatch(/clean again/);
  });

  it("lists violations when present", () => {
    const scan: WorkingTreeScan = {
      violations: [
        { file: "src/a.ts", line: 3, rule: "no-as-any", family: "type-escape", detail: "type escape" },
      ],
    };
    const msg = watchTransitionMessage(0, scan);
    expect(msg).toContain("1 violation");
    expect(msg).toContain("src/a.ts:3");
    expect(msg).toContain("no-as-any");
  });

  it("surfaces a scan error", () => {
    expect(watchTransitionMessage(0, { violations: [], error: "cannot read git diff" })).toContain("cannot read git diff");
  });
});

describe("createDebouncer", () => {
  it("coalesces a burst into one scan and honors the minimum gap", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    try {
      let count = 0;
      const d = createDebouncer({
        delayMs: 500,
        minGapMs: 1000,
        onScan: () => {
          count += 1;
        },
      });
      d.schedule();
      d.schedule();
      d.schedule();
      expect(count).toBe(0);
      vi.advanceTimersByTime(500);
      expect(count).toBe(1);
      // A second run inside the min gap is deferred to the gap boundary.
      d.schedule();
      vi.advanceTimersByTime(500);
      expect(count).toBe(1);
      vi.advanceTimersByTime(500);
      expect(count).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("cancel prevents a pending scan", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    try {
      let count = 0;
      const d = createDebouncer({
        delayMs: 500,
        minGapMs: 0,
        onScan: () => {
          count += 1;
        },
      });
      d.schedule();
      d.cancel();
      vi.advanceTimersByTime(1000);
      expect(count).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("scanWorkingTree", () => {
  it("reports an error outside a git repository instead of throwing", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "anvil-watch-"));
    try {
      const scan = scanWorkingTree(dir);
      expect(scan.violations).toEqual([]);
      expect(scan.error).toBeDefined();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
