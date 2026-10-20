import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseFlags, resolveInvocation } from "../args.js";

let stderr: string[];
let exitCodes: number[];

beforeEach(() => {
  stderr = [];
  exitCodes = [];
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    stderr.push(args.join(" "));
  });
  // The parser calls process.exit on a bad invocation; make it observable (and
  // abort the call) instead of killing the test worker.
  vi.spyOn(process, "exit").mockImplementation((code?: string | number | null) => {
    exitCodes.push(typeof code === "number" ? code : 0);
    throw new Error("__exit__");
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("parseFlags", () => {
  it("consumes values for --provider and --model", () => {
    expect(parseFlags(["--provider", "gemini", "--model", "gemini-3.6-flash"])).toEqual({
      provider: "gemini",
      model: "gemini-3.6-flash",
    });
  });

  it("accepts both spellings of prompt and goal", () => {
    expect(parseFlags(["-p", "hello"])).toEqual({ prompt: "hello" });
    expect(parseFlags(["--prompt", "hello"])).toEqual({ prompt: "hello" });
    expect(parseFlags(["-g", "ship it"])).toEqual({ goal: "ship it" });
    expect(parseFlags(["--goal", "ship it"])).toEqual({ goal: "ship it" });
  });

  it("records the boolean switches", () => {
    expect(parseFlags(["-y", "--raw", "--no-mcp"])).toEqual({
      yes: "1",
      raw: "1",
      "no-mcp": "1",
    });
  });

  it("ignores bare words (subcommands are handled by the caller)", () => {
    expect(parseFlags(["config", "-y"])).toEqual({ yes: "1" });
  });

  it("accepts a single-leading-dash value (only a doubled dash starts a flag)", () => {
    expect(parseFlags(["-p", "-42 is the answer"])).toEqual({ prompt: "-42 is the answer" });
  });

  it("parses a realistic mixed invocation", () => {
    expect(parseFlags(["--model", "gpt-5", "-y", "--prompt", "fix the bug"])).toEqual({
      model: "gpt-5",
      yes: "1",
      prompt: "fix the bug",
    });
  });

  it("fails loudly when a value-taking flag has no value", () => {
    expect(() => parseFlags(["-p"])).toThrow("__exit__");
    expect(exitCodes).toEqual([1]);
    expect(stderr.join("\n")).toContain("Missing value for -p");
  });

  it("treats a doubled dash as the next flag, not a value", () => {
    expect(() => parseFlags(["--prompt", "--yes"])).toThrow("__exit__");
    expect(exitCodes).toEqual([1]);
    expect(stderr.join("\n")).toContain("Missing value for --prompt");
  });

  it("consumes values for --base-url and --api-key", () => {
    expect(parseFlags(["--base-url", "http://localhost:8000/v1", "--api-key", "my-key"])).toEqual({
      "base-url": "http://localhost:8000/v1",
      "api-key": "my-key",
    });
  });

  it("rejects an unknown flag instead of silently falling through to chat", () => {
    expect(() => parseFlags(["--promt", "x"])).toThrow("__exit__");
    expect(exitCodes).toEqual([1]);
    expect(stderr.join("\n")).toContain("Unknown flag: --promt");
  });
});


describe("resolveInvocation", () => {
  const configured = { hasConfiguredProvider: true };

  it("honors --version/--help anywhere in argv", () => {
    expect(resolveInvocation(["-y", "--help"], configured)).toEqual({ kind: "help" });
    expect(resolveInvocation(["config", "--version"], configured)).toEqual({ kind: "version" });
  });

  it("version beats help and every subcommand", () => {
    expect(resolveInvocation(["--help", "-v"], configured)).toEqual({ kind: "version" });
    expect(resolveInvocation(["gate", "-v"], configured)).toEqual({ kind: "version" });
  });

  it("routes config to setup without chat", () => {
    expect(resolveInvocation(["config"], configured)).toEqual({ kind: "setup", thenChat: false });
  });

  // G10 (AUDIT-2026-09-30): the subcommand is the first positional token, so
  // leading flags must not hide it — and a flag's VALUE must not become one.
  it("finds the subcommand after leading flags", () => {
    expect(resolveInvocation(["--verbose", "gate"], configured)).toEqual({
      kind: "gate",
      watch: false,
      full: false,
      staged: false,
    });
    expect(resolveInvocation(["--no-mcp", "health"], configured)).toEqual({ kind: "health" });
    expect(resolveInvocation(["--verbose", "init", "--guarded"], configured)).toEqual({
      kind: "init",
      lang: undefined,
    });
    expect(resolveInvocation(["provider", "list"], configured)).toEqual({
      kind: "provider",
      args: ["list"],
    });
    expect(
      resolveInvocation(["--verbose", "provider", "add", "mygw", "--url", "http://localhost"], configured)
    ).toEqual({
      kind: "provider",
      args: ["--verbose", "add", "mygw", "--url", "http://localhost"],
    });
  });

  it("never treats a flag's value as the subcommand", () => {
    // `-p gate` is a prompt, not the gate subcommand.
    expect(resolveInvocation(["-p", "gate"], configured).kind).toBe("run");
    expect(resolveInvocation(["--provider", "gate"], configured).kind).toBe("run");
    expect(resolveInvocation(["--model", "health", "--verbose"], configured).kind).toBe("run");
  });

  it("collects the gate flags", () => {
    expect(resolveInvocation(["gate", "--watch"], configured)).toEqual({
      kind: "gate",
      watch: true,
      full: false,
      staged: false,
    });
    expect(resolveInvocation(["gate", "--full"], configured)).toEqual({
      kind: "gate",
      watch: false,
      full: true,
      staged: false,
    });
    expect(resolveInvocation(["gate", "--full", "--staged"], configured).kind).toBe("subcommand-usage-error");
  });

  it("rejects unknown subcommand flags and extra positional arguments", () => {
    expect(resolveInvocation(["gate", "--ful"], configured)).toEqual({
      kind: "subcommand-usage-error", subcommand: "gate", argument: "--ful",
    });
    expect(resolveInvocation(["init", "--guarded", "--lnag", "python"], configured)).toEqual({
      kind: "subcommand-usage-error", subcommand: "init", argument: "--lnag",
    });
    expect(resolveInvocation(["health", "extra"], configured)).toEqual({
      kind: "subcommand-usage-error", subcommand: "health", argument: "extra",
    });
  });

  it("routes health", () => {
    expect(resolveInvocation(["health"], configured)).toEqual({ kind: "health" });
  });

  it("requires --guarded for init and reads --lang", () => {
    expect(resolveInvocation(["init"], configured)).toEqual({ kind: "init-usage-error" });
    expect(resolveInvocation(["init", "--guarded"], configured)).toEqual({
      kind: "init",
      lang: undefined,
    });
    expect(resolveInvocation(["init", "--guarded", "--lang", "python"], configured)).toEqual({
      kind: "init",
      lang: "python",
    });
    expect(resolveInvocation(["init", "--guarded", "--lang"], configured)).toEqual({
      kind: "init-usage-error",
    });
    expect(resolveInvocation(["init", "--guarded", "--lang", "--verbose"], configured)).toEqual({
      kind: "init-usage-error",
    });
  });

  it("onboards when nothing is configured, runs otherwise", () => {
    expect(resolveInvocation([], { hasConfiguredProvider: false })).toEqual({
      kind: "setup",
      thenChat: true,
    });
    expect(resolveInvocation([], configured)).toEqual({ kind: "run" });
  });

  it("a configured install with flags still runs (not onboarding)", () => {
    expect(resolveInvocation(["-p", "hi"], configured)).toEqual({ kind: "run" });
  });

  it("reports explicit provider configuration errors instead of opening first-run setup", () => {
    expect(resolveInvocation(["--provider", "custom:missing", "-p", "hi"], { hasConfiguredProvider: false })).toEqual({ kind: "run" });
  });
});
