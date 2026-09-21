import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * ENTRY-POINT HARNESS
 *
 * `index.tsx` runs its dispatch at module scope, so the only way to exercise it
 * is to set argv, stub the terminating syscalls, and import it fresh. The
 * branches covered here all terminate BEFORE any rendering or provider I/O, so
 * no Ink mount and no network are involved. Vitest isolates each test file's
 * environment, so the process handlers index.tsx registers do not leak into
 * other suites.
 */

let home: string;
let originalArgv: string[];
let originalHome: string | undefined;

beforeEach(() => {
  vi.resetModules();
  // Never touch the developer's real ~/.anvil during a test run.
  home = fs.mkdtempSync(path.join(os.tmpdir(), "anvil-entry-"));
  originalHome = process.env.ANVIL_HOME;
  process.env.ANVIL_HOME = home;
  originalArgv = process.argv;
});

afterEach(() => {
  process.argv = originalArgv;
  if (originalHome === undefined) delete process.env.ANVIL_HOME;
  else process.env.ANVIL_HOME = originalHome;
  fs.rmSync(home, { recursive: true, force: true });
  vi.restoreAllMocks();
});

async function runEntry(argv: string[]): Promise<{ exit: number[]; out: string[]; err: string[] }> {
  const exit: number[] = [];
  const out: string[] = [];
  const err: string[] = [];
  vi.spyOn(process, "exit").mockImplementation((code?: string | number | null) => {
    exit.push(typeof code === "number" ? code : 0);
    // index.tsx calls process.exit to terminate the dispatch; throwing here
    // stops module evaluation the same way, so the import rejects.
    throw new Error("__exit__");
  });
  vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => {
    out.push(a.join(" "));
  });
  vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => {
    err.push(a.join(" "));
  });
  process.argv = ["node", "anvil", ...argv];
  try {
    await import("../index.js");
  } catch (e) {
    if (!(e instanceof Error) || e.message !== "__exit__") throw e;
  }
  return { exit, out, err };
}

describe("CLI entry dispatch", () => {
  it("--version prints the version and exits 0", async () => {
    const { exit, out } = await runEntry(["--version"]);
    expect(exit).toEqual([0]);
    expect(out.join(" ")).toMatch(/anvil \d+\.\d+\.\d+/);
  });

  it("init without --guarded prints usage and exits 1", async () => {
    const { exit, err } = await runEntry(["init"]);
    expect(exit).toEqual([1]);
    expect(err.join(" ")).toContain("anvil init --guarded");
  });
});
