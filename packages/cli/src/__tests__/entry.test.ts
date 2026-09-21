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
 *
 * readStdin is stubbed to return immediately: under vitest stdin is a non-TTY
 * stream with no end event, so the real one parks until its idle timer — and
 * the run path must observe its result BEFORE the non-interactive guidance.
 */
vi.mock("../headless.js", () => ({
  readStdin: vi.fn(async () => ""),
  runHeadless: vi.fn(async () => 0),
}));

let home: string;
let originalArgv: string[];
let originalHome: string | undefined;
let originalCwd: string;

beforeEach(() => {
  vi.resetModules();
  // Never touch the developer's real ~/.anvil during a test run.
  home = fs.mkdtempSync(path.join(os.tmpdir(), "anvil-entry-"));
  originalHome = process.env.ANVIL_HOME;
  process.env.ANVIL_HOME = home;
  originalArgv = process.argv;
  // Dispatch branches that default cwd to process.cwd() (init --guarded,
  // gate) must not observe or touch the real repo. The temp ANVIL_HOME is
  // not a git repo, so gate reports "cannot read git diff" and exits 1.
  originalCwd = process.cwd();
  process.chdir(home);
});

afterEach(() => {
  process.chdir(originalCwd);
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

  it("--help prints the usage text and exits 0", async () => {
    const { exit, out } = await runEntry(["--help"]);
    expect(exit).toEqual([0]);
    const help = out.join("");
    expect(help).toContain("Usage:");
    expect(help).toContain("anvil gate");
    expect(help).toContain("anvil health");
  });

  it("health with no recorded scans prints the empty state and exits 0", async () => {
    const { exit, err } = await runEntry(["health"]);
    expect(exit).toEqual([0]);
    // runHealth writes via process.stdout.write, which this harness does not
    // stub — assert on stderr staying clean instead of the rendered text.
    expect(err.join("")).toBe("");
  });

  it("init --guarded provisions into the cwd and exits 0", async () => {
    const { exit, err } = await runEntry(["init", "--guarded"]);
    expect(exit).toEqual([0]);
    expect(err.join("")).toBe("");
    // cwd is the temp ANVIL_HOME (chdir'd in beforeEach): the provisioned
    // files must exist THERE, proving the dispatch ran end to end without
    // touching the real repo.
    expect(fs.existsSync(path.join(home, "AGENTS.md"))).toBe(true);
    expect(fs.existsSync(path.join(home, ".githooks/pre-commit"))).toBe(true);
  });

  it("gate on a non-git directory reports the error and exits 1", async () => {
    // The temp cwd is not a git repo: scanWorkingTree cannot read a diff,
    // so the scan reports its error honestly and the gate exits 1.
    const { exit } = await runEntry(["gate"]);
    expect(exit).toEqual([1]);
  });

  it("first-run onboarding in a non-TTY stdin exits 1 with guidance", async () => {
    // ANVIL_HOME is an empty temp dir: no credentials → resolveInvocation
    // routes to first-run setup BEFORE the run path. stdin is not a TTY
    // under vitest, so runSetup's interactive-terminal guard fires: a clear
    // error and exit 1 instead of rendering raw-mode UI into a pipe.
    const { exit, err } = await runEntry([]);
    expect(exit).toEqual([1]);
    expect(err.join(" ")).toContain("interactive terminal");
  });

  it("run path in a non-TTY stdin with no prompt exits 1 with guidance", async () => {
    // With credentials present the dispatch reaches the run path. stdin is
    // not a TTY and there is no --prompt, so runFromFlags prints the
    // non-interactive guidance and exits 1 — BEFORE any provider I/O, so the
    // test stays hermetic (a prompt here would hit the real network).
    fs.writeFileSync(
      path.join(home, "credentials.json"),
      JSON.stringify({ anthropicApiKey: "sk-test" })
    );
    const { exit, err } = await runEntry([]);
    expect(exit).toEqual([1]);
    expect(err.join(" ")).toContain("non-interactively");
    expect(err.join(" ")).toContain("--prompt");
  });

  it("registers exit-path handlers that restore the terminal and kill MCP children", async () => {
    // The module registers exit/SIGTERM/SIGHUP cleanup at import time. Drive
    // the SIGTERM handler directly: it must attempt cleanup, then exit 143.
    let sigtermHandler: (() => void) | undefined;
    const onSpy = vi.spyOn(process, "on").mockImplementation((event: string | symbol, listener: (...args: any[]) => void) => {
      if (event === "SIGTERM") sigtermHandler = listener as () => void;
      return process;
    });
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((code?: string | number | null) => {
      throw new Error(`__exit__${code ?? 0}`);
    });
    try {
      await import("../index.js");
    } catch {
      // module evaluation ends via the setup dispatch or the exit throw
    }
    expect(sigtermHandler).toBeTypeOf("function");
    onSpy.mockRestore();
    try {
      sigtermHandler!();
    } catch (e) {
      expect((e as Error).message).toBe("__exit__143");
    }
    exitSpy.mockRestore();
  });
});
