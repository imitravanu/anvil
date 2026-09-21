import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import React from "react";

/**
 * BOOT HARNESS
 *
 * Covers index.tsx's MOUNTED paths: bootChat / bootHeadless / bootGoal /
 * runSetup(thenChat). The dispatch itself runs at module scope, so the
 * harness still imports index.tsx fresh per test with argv set — but every
 * side-effectful boundary is mocked:
 *
 *   - ink's render: captures the App element + props, returns a handle
 *     (unmount is what bootChat's appInstance teardown exercises)
 *   - headless.js / goalRunner.js: runHeadless/runGoalHeadless resolve with
 *     a recorded code; readStdin returns "" instantly (the real one parks
 *     on a non-TTY stream until its idle timer)
 *   - core's AgentSession: its constructor wires a real provider object;
 *     the fake keeps boot hermetic without network
 *   - core's syncFreeModels: fire-and-forget at boot — must never hit the
 *     network from a test
 *
 * Everything between the mocks is REAL: MCP/plugin resolution (--no-mcp
 * pins that path off), provider selection from a temp credentials.json,
 * system-prompt assembly, theme resolution from settings.json, alt-screen
 * (no-op under TERM=dumb), signal-handler registration, and the
 * exit-code plumbing through process.exit.
 */

const renderCalls: { element: { type: unknown; props: Record<string, unknown> } | null; unmount: ReturnType<typeof vi.fn> }[] = [];
const headlessCalls: { prompt: string; opts: Record<string, unknown> }[] = [];
const goalCalls: { goal: string; opts: Record<string, unknown> }[] = [];
let headlessCode = 0;
let goalCode = 0;

vi.mock("ink", () => ({
  render: vi.fn((element: { type: unknown; props: Record<string, unknown> }) => {
    const unmount = vi.fn(() => undefined);
    renderCalls.push({ element, unmount });
    return { unmount };
  }),
}));

vi.mock("../headless.js", () => ({
  readStdin: vi.fn(async () => ""),
  runHeadless: vi.fn(async (opts: Record<string, unknown>) => {
    headlessCalls.push({ prompt: String(opts.prompt ?? ""), opts });
    return headlessCode;
  }),
}));

vi.mock("../goalRunner.js", () => ({
  runGoalHeadless: vi.fn(async (opts: Record<string, unknown>) => {
    goalCalls.push({ goal: String(opts.goal ?? ""), opts });
    return goalCode;
  }),
}));

vi.mock("@anvil/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@anvil/core")>();
  class FakeAgentSession {
    readonly projectRoot: string;
    readonly provider: unknown;
    constructor(provider: unknown, options: { projectRoot: string }) {
      this.provider = provider;
      this.projectRoot = options.projectRoot;
    }
    // bootChat only constructs the session; no send happens at module scope.
  }
  return {
    ...actual,
    AgentSession: FakeAgentSession,
    syncFreeModels: vi.fn(async () => undefined),
  };
});

let home: string;
let originalArgv: string[];
let originalHome: string | undefined;
let originalCwd: string;

beforeEach(() => {
  vi.clearAllMocks();
  renderCalls.length = 0;
  headlessCalls.length = 0;
  goalCalls.length = 0;
  headlessCode = 0;
  goalCode = 0;
  vi.resetModules();
  home = fs.mkdtempSync(path.join(os.tmpdir(), "anvil-boot-"));
  originalHome = process.env.ANVIL_HOME;
  process.env.ANVIL_HOME = home;
  originalArgv = process.argv;
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

function writeCreds(creds: Record<string, string>): void {
  fs.writeFileSync(path.join(home, "credentials.json"), JSON.stringify(creds));
}

function writeSettings(settings: Record<string, unknown>): void {
  fs.writeFileSync(path.join(home, "settings.json"), JSON.stringify(settings));
}

interface BootResult {
  exit: number[];
  err: string[];
}

async function runEntry(argv: string[]): Promise<BootResult> {
  const exit: number[] = [];
  const err: string[] = [];
  vi.spyOn(process, "exit").mockImplementation((code?: string | number | null) => {
    exit.push(typeof code === "number" ? code : 0);
    throw new Error("__exit__");
  });
  vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => {
    err.push(a.join(" "));
  });
  process.argv = ["node", "anvil", ...argv];
  try {
    await import("../index.js");
    // bootHeadless/bootGoal terminate via process.exit (thrown above);
    // bootChat resolves without exiting, leaving the Ink handle live.
  } catch (e) {
    if (!(e instanceof Error) || e.message !== "__exit__") throw e;
  }
  return { exit, err };
}

const APP = "app-element-marker";

/** Run a handler that is expected to process.exit(code) via the thrown sentinel. */
function expectThrownExit(handler: (() => void) | undefined, code: number): void {
  try {
    handler!();
    expect.unreachable("handler should have exited");
  } catch (e) {
    expect((e as Error).message).toBe(`__exit__${code}`);
  }
}

describe("boot paths", () => {
  it("bootHeadless passes the prompt, flags, and resolved provider; exits with the runner's code", async () => {
    writeCreds({ anthropicApiKey: "sk-test" });
    headlessCode = 7;
    const { exit } = await runEntry(["-p", "fix the bug", "--yes", "--raw", "--no-mcp"]);
    expect(headlessCalls).toHaveLength(1);
    expect(headlessCalls[0]!.prompt).toBe("fix the bug");
    expect(headlessCalls[0]!.opts.autoApprove).toBe(true);
    expect(headlessCalls[0]!.opts.raw).toBe(true);
    expect(headlessCalls[0]!.opts.model).toBe("claude-opus-5");
    // --no-mcp pins the no-MCP path: no connection map entries are possible.
    expect(exit).toEqual([7]);
    expect(renderCalls).toHaveLength(0); // headless never mounts Ink
  });

  it("bootGoal passes the goal and exits with the runner's code", async () => {
    writeCreds({ anthropicApiKey: "sk-test" });
    goalCode = 3;
    const { exit } = await runEntry(["-g", "ship the feature"]);
    expect(goalCalls).toHaveLength(1);
    expect(goalCalls[0]!.goal).toBe("ship the feature");
    expect(exit).toEqual([3]);
  });

  it("bootChat mounts App with the resolved provider, broker, and MCP reconnect wiring", async () => {
    writeCreds({ anthropicApiKey: "sk-test" });
    writeSettings({ theme: "dark" });
    // runFromFlags consults stdin.isTTY before dispatching to chat; under
    // vitest stdin is a pipe, so fake the interactive terminal for the
    // duration of the boot (restored in finally).
    const tty = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
    try {
      const { exit } = await runEntry([]);
      // bootChat resolves and stays mounted: no exit, one Ink mount.
      expect(exit).toEqual([]);
      expect(renderCalls).toHaveLength(1);
      const props = renderCalls[0]!.element!.props;
      expect(props.providerId).toBe("anthropic");
      expect(props.model).toBe("claude-opus-5");
      expect(props.initialTheme).toBe("dark");
      const mcp = props.mcp as { list: () => unknown[]; reconnect: () => Promise<unknown> };
      expect(typeof mcp.reconnect).toBe("function");
      await expect(mcp.reconnect()).resolves.toBeDefined();
      expect(typeof (props.sessionOptions as Record<string, unknown>).autoVerify).toBe("boolean");
    } finally {
      if (tty) Object.defineProperty(process.stdin, "isTTY", tty);
      else delete (process.stdin as { isTTY?: boolean }).isTTY;
    }
  });

  it("first-run setup (no credentials) chains into chat after onDone", async () => {
    // No credentials + interactive stdin → resolveInvocation returns
    // first-run setup with thenChat=true. (The explicit `config` subcommand
    // sets thenChat=false — covered by the test below.) The real card saves
    // the key BEFORE calling onDone; simulate that, or the chained chat
    // boot exits 1 at provider selection. bootChat awaits MCP/plugin
    // resolution before mounting — poll for the second mount.
    const tty = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
    try {
      const { exit } = await runEntry([]);
      expect(exit).toEqual([]);
      expect(renderCalls).toHaveLength(1);
      // FirstRunSetup, not App: its props carry onDone and no session wiring.
      const setupProps = renderCalls[0]!.element!.props;
      expect(typeof setupProps.onDone).toBe("function");
      expect(setupProps.session).toBeUndefined();
      writeCreds({ anthropicApiKey: "sk-test" });
      const props = renderCalls[0]!.element!.props;
      (props.onDone as (providerId: unknown) => void)("anthropic");
      for (let i = 0; i < 100 && renderCalls.length < 2; i++) {
        await new Promise((r) => setTimeout(r, 10));
      }
      expect(renderCalls[0]!.unmount).toHaveBeenCalled();
      expect(renderCalls.length).toBeGreaterThanOrEqual(2);
      const chatProps = renderCalls[renderCalls.length - 1]!.element!.props;
      expect(chatProps.providerId).toBe("anthropic");
      expect(exit).toEqual([]);
    } finally {
      if (tty) Object.defineProperty(process.stdin, "isTTY", tty);
      else delete (process.stdin as { isTTY?: boolean }).isTTY;
    }
  });

  it("config with credentials present re-enters setup directly (no thenChat)", async () => {
    writeCreds({ anthropicApiKey: "sk-test" });
    const tty = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
    try {
      const { exit } = await runEntry(["config"]);
      expect(exit).toEqual([]);
      expect(renderCalls).toHaveLength(1);
      const props = renderCalls[0]!.element!.props;
      (props.onDone as (providerId: unknown) => void)("anthropic");
      await new Promise((r) => setTimeout(r, 0));
      // thenChat=false: onDone exits the alt screen instead of chaining chat.
      expect(renderCalls).toHaveLength(1);
    } finally {
      if (tty) Object.defineProperty(process.stdin, "isTTY", tty);
      else delete (process.stdin as { isTTY?: boolean }).isTTY;
    }
  });

  it("registers SIGHUP and unhandledRejection containment handlers", async () => {
    // Captured from module scope (before the dispatch terminates the import):
    // SIGHUP must restore the terminal, kill MCP children, and exit 129 —
    // an unhandledRejection must be REPORTED and set exitCode, never crash.
    const handlers = new Map<string, (...args: unknown[]) => void>();
    const onSpy = vi.spyOn(process, "on").mockImplementation(
      (event: string | symbol, listener: (...args: unknown[]) => void) => {
        handlers.set(String(event), listener);
        return process;
      }
    );
    const errSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(
      (code?: string | number | null): never => {
        throw new Error(`__exit__${code ?? 0}`);
      }
    );
    try {
      await import("../index.js");
    } catch {
      // dispatch ends via the setup guard's exit
    }
    onSpy.mockRestore();
    const sighup = handlers.get("SIGHUP");
    expect(sighup, "SIGHUP handler registered at import").toBeTypeOf("function");
    expectThrownExit(sighup, 129);
    const unhandled = handlers.get("unhandledRejection");
    expect(unhandled).toBeTypeOf("function");
    const savedExitCode = process.exitCode;
    unhandled!(new Error("boom"));
    expect(errSpy.mock.calls.map((c) => String(c[0])).join("")).toContain(
      "unhandled promise rejection"
    );
    expect(process.exitCode).toBe(1);
    process.exitCode = savedExitCode;
    exitSpy.mockRestore();
    errSpy.mockRestore();
  });
});
