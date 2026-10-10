import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import {
  claimSignal,
  createDebouncer,
  formatWatchBanner,
  isSignalClaimed,
  releaseSignal,
  scanWorkingTree,
  watchDirectories,
  watchScan,
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

  // Takeover 2026-10-10: the Linux watcher (no recursive fs.watch) used to
  // watch only the top TWO levels, so a save to packages/*/src/* — most of a
  // real repo — fired no event, and the comment promising a "diff rescan on
  // save" described code that never existed. The walk is now the whole tree.
  describe("watchDirectories (the Linux watch surface)", () => {
    it("covers the whole tree, excluding dependency/generated/VCS dirs", () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), "anvil-watch-walk-"));
      try {
        for (const rel of [
          "packages/core/src/tools",
          "packages/cli/src/nested/deep",
          "docs",
          "node_modules/leftpad",
          "dist/out",
          ".git/objects",
        ]) {
          fs.mkdirSync(path.join(root, rel), { recursive: true });
        }
        const dirs = watchDirectories(root, 256);
        // Depth-4 source dirs are watched — the exact saves the old two-level
        // walk never saw.
        expect(dirs).toContain(path.join(root, "packages", "cli", "src", "nested", "deep"));
        expect(dirs).toContain(path.join(root, "docs"));
        // Generated/dependency/VCS trees are never watched.
        expect(dirs.some((d) => d.includes("node_modules"))).toBe(false);
        expect(dirs.some((d) => d.includes(`${path.sep}dist`))).toBe(false);
        expect(dirs.some((d) => d.includes(".git"))).toBe(false);
        // The root itself is always watched first.
        expect(dirs[0]).toBe(root);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });

    it("respects the watcher cap so a pathological workspace cannot open thousands of watchers", () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), "anvil-watch-cap-"));
      try {
        for (let i = 0; i < 40; i++) {
          fs.mkdirSync(path.join(root, `d${i}`), { recursive: true });
        }
        expect(watchDirectories(root, 5)).toHaveLength(5);
        expect(watchDirectories(root, 256)).toHaveLength(41); // root + 40 children
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });
  });

  // G8 (AUDIT-2026-09-30): --staged used to be silently dropped; the banner
  // must now say which surface is actually being scanned.
  it("names the STAGED scope when --staged is in effect", () => {
    const banner = formatWatchBanner("/tmp/proj", { staged: true });
    expect(banner).toContain("STAGED diff");
    expect(banner).not.toContain("working-tree diff vs HEAD");
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

  // G8 honesty: the transition line must name the surface actually scanned, so
  // a --staged watch session never reports a working-tree result.
  it("names the STAGED surface when scoped to staged", () => {
    const scan: WorkingTreeScan = {
      violations: [
        { file: "src/a.ts", line: 3, rule: "no-as-any", family: "type-escape", detail: "type escape" },
      ],
    };
    expect(watchTransitionMessage(0, scan, "staged")).toContain("in the staged diff");
    expect(watchTransitionMessage(1, { violations: [] }, "staged")).toContain("staged diff is clean");
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

describe("watchScan (G8: --staged is honored, not dropped)", () => {
  it("scans the staged surface when staged=true and the working tree otherwise", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "anvil-watch-"));
    try {
      const git = (args: string[]): void => {
        const res = spawnSync("git", args, { cwd: dir, encoding: "utf-8" });
        if (res.status !== 0) throw new Error(res.stderr);
      };
      git(["init", "-q"]);
      git(["config", "user.email", "t@t.t"]);
      git(["config", "user.name", "t"]);
      // A staged violation in a repo with NO commit: `git diff --cached` sees
      // it, but `git diff HEAD` cannot (no HEAD) — so the two surfaces differ.
      const file = path.join(dir, "packages", "core", "src", "evil.ts");
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, "export const x = data as any;\n", "utf-8");
      git(["add", "packages/core/src/evil.ts"]);

      const staged = watchScan(dir, true);
      const working = watchScan(dir, false);
      expect(staged.violations.length, "--staged must scan staged additions").toBeGreaterThan(0);
      expect(working.error, "working-tree scan has no HEAD to diff against").toBeDefined();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("signal claim registry (G8: global handlers defer only to an OWNED runner)", () => {
  it("is false until a runner claims the signal", () => {
    expect(isSignalClaimed("SIGTERM")).toBe(false);
  });

  it("is true after claim and false again after release", () => {
    claimSignal("SIGTERM");
    try {
      expect(isSignalClaimed("SIGTERM")).toBe(true);
    } finally {
      releaseSignal("SIGTERM");
    }
    expect(isSignalClaimed("SIGTERM")).toBe(false);
  });

  // The regression this replaces: a FOREIGN listener (a library, or the test
  // runner) used to inflate the listener count and make the global SIGTERM
  // handler wrongly defer, skipping terminal restore + MCP cleanup.
  it("a foreign listener does NOT make a signal claimed", () => {
    const foreign = (): void => {};
    process.on("SIGTERM", foreign);
    try {
      expect(isSignalClaimed("SIGTERM")).toBe(false);
    } finally {
      process.removeListener("SIGTERM", foreign);
    }
  });
});
