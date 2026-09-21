import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { log, resolveLogLevel } from "../logger.js";

/**
 * Logger tests — Phase 24.5 original contract plus the ANVIL_LOG level gate.
 * The logger is core's single stderr writer; these pin the level gate
 * (env-driven, lazily read so tests can flip it), the legacy ANVIL_DEBUG
 * alias, and the output prefixes other code and docs rely on.
 */

let stderr: string[];
let spy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  stderr = [];
  spy = vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    stderr.push(String(chunk));
    return true;
  });
});

afterEach(() => {
  spy.mockRestore();
  delete process.env.ANVIL_LOG;
  delete process.env.ANVIL_DEBUG;
});

describe("Logger (Phase 24.5)", () => {
  it("writes info, warn, error to stderr with anvil prefix (at their default levels off; set ANVIL_LOG=info)", () => {
    process.env.ANVIL_LOG = "info";
    log.info("hello world");
    log.warn("warning message");
    log.error("error message");
    const out = stderr.join("");
    expect(out).toContain("[anvil] hello world\n");
    expect(out).toContain("[anvil] ⚠ warning message\n");
    expect(out).toContain("[anvil] ✗ error message\n");
  });

  it("writes debug only when ANVIL_DEBUG is set (legacy alias for ANVIL_LOG=debug)", () => {
    delete process.env.ANVIL_LOG;
    log.debug("silent debug");
    expect(stderr).toHaveLength(0);

    process.env.ANVIL_DEBUG = "1";
    log.debug("loud debug");
    expect(stderr.join("")).toContain("[anvil] 🔍 loud debug\n");
  });
});

describe("logger level gate (ANVIL_LOG)", () => {
  it("defaults to warn: warnings and errors visible, info/debug suppressed", () => {
    expect(resolveLogLevel()).toBe("warn");
    log.debug("d");
    log.info("i");
    log.warn("w");
    log.error("e");
    const out = stderr.join("");
    expect(out).not.toContain(" d");
    expect(out).not.toContain(" i");
    expect(out).toContain("⚠ w");
    expect(out).toContain("✗ e");
  });

  it("ANVIL_LOG=info turns on info but not debug", () => {
    process.env.ANVIL_LOG = "info";
    log.debug("d");
    log.info("i");
    expect(stderr.join("")).not.toContain("d");
    expect(stderr.join("")).toContain("i");
  });

  it("level is read lazily per call — flipping env mid-flight works", () => {
    process.env.ANVIL_LOG = "silent";
    log.error("hidden");
    expect(stderr).toHaveLength(0);
    process.env.ANVIL_LOG = "debug";
    log.debug("shown");
    expect(stderr.join("")).toContain("🔍 shown");
  });

  it("an unknown ANVIL_LOG value falls back to warn, not to verbose", () => {
    process.env.ANVIL_LOG = "chatty";
    expect(resolveLogLevel()).toBe("warn");
  });

  it("ANVIL_LOG=silent silences even errors", () => {
    process.env.ANVIL_LOG = "silent";
    log.error("e");
    expect(stderr).toHaveLength(0);
  });
});
