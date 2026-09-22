import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * FATAL-FAILURE PATHS
 *
 * `index.tsx` is the one file where "what happens when this goes wrong" decides
 * whether a user's terminal survives. `boot.test.tsx` covers the happy boots,
 * SIGHUP, and the unhandledRejection containment; the two gaps left open are:
 *
 *  1. the `uncaughtException` crash guard, which must restore the screen and
 *     raw mode BEFORE printing the detail, and always print a detail (a crash
 *     whose output is lost in a discarded alt buffer is unactionable), and
 *  2. the SIGINT listener-count guard: the CLI must yield to a runner's own
 *     cancellation handler instead of hard-exiting under it.
 *
 * Handlers are registered at module scope, so a fresh import is the only way to
 * reach them. They are captured (and never invoked by the runtime) rather than
 * triggered for real, so the worker cannot actually die.
 *
 * NOTE: deliberately NOT covered — `resolveSelectionOrExit`'s "No provider is
 * configured" branch is unreachable from the run path, because `resolveInvocation`
 * only returns `run` when a provider IS configured. It is retained as a
 * belt-and-braces guard; asserting it would mean testing dead behavior.
 */

/** Records headless invocations: the failure paths must never reach a turn. */
const headlessCalls: unknown[][] = [];

vi.mock("../headless.js", () => ({
  readStdin: vi.fn(async () => ""),
  runHeadless: vi.fn(async (...args: unknown[]) => {
    headlessCalls.push(args);
    return 0;
  }),
}));

vi.mock("@anvil/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@anvil/core")>();
  // Fire-and-forget at boot: must never hit the network from a test.
  return { ...actual, syncFreeModels: vi.fn(async () => undefined) };
});

let home: string;
let originalArgv: string[];
let originalHome: string | undefined;
let originalCwd: string;
let originalProvider: string | undefined;
let originalModel: string | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  headlessCalls.length = 0;
  vi.resetModules();
  home = fs.mkdtempSync(path.join(os.tmpdir(), "anvil-fatal-"));
  originalHome = process.env.ANVIL_HOME;
  process.env.ANVIL_HOME = home;
  // Inherited provider/model would silently change which branch boots.
  originalProvider = process.env.ANVIL_PROVIDER;
  originalModel = process.env.ANVIL_MODEL;
  delete process.env.ANVIL_PROVIDER;
  delete process.env.ANVIL_MODEL;
  originalArgv = process.argv;
  originalCwd = process.cwd();
  process.chdir(home);
});

afterEach(() => {
  process.chdir(originalCwd);
  process.argv = originalArgv;
  if (originalHome === undefined) delete process.env.ANVIL_HOME;
  else process.env.ANVIL_HOME = originalHome;
  if (originalProvider === undefined) delete process.env.ANVIL_PROVIDER;
  else process.env.ANVIL_PROVIDER = originalProvider;
  if (originalModel === undefined) delete process.env.ANVIL_MODEL;
  else process.env.ANVIL_MODEL = originalModel;
  fs.rmSync(home, { recursive: true, force: true });
  vi.restoreAllMocks();
});

const EXIT = "__exit__";

interface EntryRun {
  handlers: Map<string, (...args: unknown[]) => void>;
  exit: number[];
  /** How many exits happened during the boot itself (before any handler ran). */
  bootExits: number;
  out: string[];
  err: string[];
  /** process.stderr.write output — the crash guard bypasses console.error. */
  rawErr: string[];
}

/** Exits recorded by invoking `handler` — ignores the boot's own exits. */
function exitsFrom(handler: (...args: unknown[]) => void, run: EntryRun, arg?: unknown): number[] {
  try {
    handler(arg);
  } catch (e) {
    if (e instanceof Error && e.message === EXIT) {
      /* expected: the handler asked to exit */
    } else {
      throw e;
    }
  }
  return run.exit.slice(run.bootExits);
}

function writeCreds(creds: Record<string, string>): void {
  fs.writeFileSync(path.join(home, "credentials.json"), JSON.stringify(creds));
}

/** Import `index.tsx` fresh with `argv`, capturing handlers, output, and exits. */
async function bootEntry(argv: string[]): Promise<EntryRun> {
  const handlers = new Map<string, (...args: unknown[]) => void>();
  const exit: number[] = [];
  const out: string[] = [];
  const err: string[] = [];
  const rawErr: string[] = [];

  // The dispatch runs `void runFromFlags(...)`, so a process.exit there throws
  // INSIDE a promise chain and surfaces as a rejection. Capture handlers with a
  // mocked `process.on`, so install a real containment listener for the boot and
  // remove it once the rejected dispatch has settled — otherwise vitest reports
  // it as an unhandled error from the test file.
  const realOn = process.on.bind(process);
  const realOff = process.off.bind(process);
  const swallow = (): void => undefined;
  realOn("unhandledRejection", swallow);

  const onSpy = vi.spyOn(process, "on").mockImplementation(
    (event: string | symbol, listener: (...args: unknown[]) => void) => {
      handlers.set(String(event), listener);
      return process;
    }
  );
  vi.spyOn(process, "exit").mockImplementation((code?: string | number | null): never => {
    exit.push(typeof code === "number" ? code : 0);
    throw new Error(EXIT);
  });
  vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => {
    out.push(a.join(" "));
  });
  vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => {
    err.push(a.join(" "));
  });
  vi.spyOn(process.stderr, "write").mockImplementation((chunk: string | Uint8Array) => {
    rawErr.push(String(chunk));
    return true;
  });

  process.argv = ["node", "anvil", ...argv];
  try {
    await import("../index.js");
    // Chat boots resolve without exiting; the handlers stay registered.
  } catch (e) {
    if (!(e instanceof Error) || e.message !== EXIT) throw e;
  }
  // Let the async dispatch settle (and be swallowed) before dropping the net.
  await new Promise((resolve) => setImmediate(resolve));
  realOff("unhandledRejection", swallow);
  onSpy.mockRestore();
  // `exit` now holds BOOT-time exits; handler tests measure from this mark so
  // the dispatch's own exit (e.g. --version → 0) cannot pollute their assertion.
  return { handlers, exit, bootExits: exit.length, out, err, rawErr };
}

describe("uncaughtException crash guard", () => {
  it("restores the screen, prints the detail to stderr, and exits 1", async () => {
    const run = await bootEntry(["--version"]);
    const crash = run.handlers.get("uncaughtException");
    expect(crash, "crash guard must be registered").toBeTypeOf("function");

    expect(exitsFrom(crash!, run, new Error("kaboom in the TUI"))).toEqual([1]);

    const text = run.rawErr.join("");
    // Header first: the user needs to know this is a crash, not a tool failure.
    expect(text).toContain("Anvil hit an unexpected error:");
    expect(text).toContain("kaboom in the TUI");
  });

  it("falls back to the message when an Error carries no stack", async () => {
    const run = await bootEntry(["--version"]);
    const crash = run.handlers.get("uncaughtException")!;

    // `stack` is absent on some thrown values; a guard that only prints the
    // stack would then emit nothing but the header.
    const stackless = new Error("stackless detail");
    stackless.stack = undefined;
    expect(exitsFrom(crash, run, stackless)).toEqual([1]);

    const text = run.rawErr.join("");
    expect(text).toContain("Anvil hit an unexpected error:");
    expect(text).toContain("stackless detail");
  });

  it("reports a non-Error throw instead of printing nothing", async () => {
    const run = await bootEntry(["--version"]);
    const crash = run.handlers.get("uncaughtException")!;

    // `throw "string"` is legal JS; the guard must still say what happened.
    expect(exitsFrom(crash, run, "thrown from a provider callback")).toEqual([1]);

    const text = run.rawErr.join("");
    expect(text).toContain("Anvil hit an unexpected error:");
    expect(text).toContain("thrown from a provider callback");
  });
});

describe("SIGINT listener-count guard", () => {
  it("exits 130 when no runner has attached its own cancellation handler", async () => {
    const run = await bootEntry(["--version"]);
    const onInt = run.handlers.get("SIGINT");
    expect(onInt, "SIGINT handler must be registered").toBeTypeOf("function");

    vi.spyOn(process, "listenerCount").mockReturnValue(1);
    expect(exitsFrom(onInt!, run)).toEqual([130]);
  });

  it("stays out of the way when a runner owns the cancellation", async () => {
    const run = await bootEntry(["--version"]);
    const onInt = run.handlers.get("SIGINT")!;

    // A running session registers its own SIGINT handler to cancel gracefully
    // (rather than kill mid-tool-call). The CLI must not hard-exit under it.
    vi.spyOn(process, "listenerCount").mockReturnValue(2);
    expect(exitsFrom(onInt, run)).toEqual([]);
    expect(run.rawErr).toEqual([]);
  });
});

describe("provider selection failure on the run path", () => {
  it("reports the unusable provider and exits before running anything", async () => {
    // OpenAI is configured, so the invocation resolves to `run`; the explicit
    // flag then asks for a DIFFERENT provider with no key.
    writeCreds({ openaiApiKey: "sk-test" });

    const run = await bootEntry([
      "-p",
      "hello",
      "--no-mcp",
      "--provider",
      "anthropic",
    ]);

    // This exit comes from the BOOT dispatch, so read the whole array.
    expect(run.exit).toEqual([1]);
    const message = run.err.join("\n");
    // The selection error must name the provider so the fix is obvious.
    expect(message.toLowerCase()).toContain("anthropic");
    // Failed selection happens BEFORE the turn: no wasted provider call.
    expect(headlessCalls).toEqual([]);
  });
});
