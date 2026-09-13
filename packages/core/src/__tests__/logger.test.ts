import { describe, expect, it, vi } from "vitest";
import { log } from "../logger.js";

describe("Logger (Phase 24.5)", () => {
  it("writes info, warn, error to stderr with anvil prefix", () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);

    log.info("hello world");
    expect(stderrSpy).toHaveBeenCalledWith("[anvil] hello world\n");

    log.warn("warning message");
    expect(stderrSpy).toHaveBeenCalledWith("[anvil] ⚠ warning message\n");

    log.error("error message");
    expect(stderrSpy).toHaveBeenCalledWith("[anvil] ✗ error message\n");

    stderrSpy.mockRestore();
  });

  it("writes debug only when ANVIL_DEBUG is set", () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    const oldDebug = process.env.ANVIL_DEBUG;

    delete process.env.ANVIL_DEBUG;
    log.debug("silent debug");
    expect(stderrSpy).not.toHaveBeenCalled();

    process.env.ANVIL_DEBUG = "1";
    log.debug("loud debug");
    expect(stderrSpy).toHaveBeenCalledWith("[anvil] 🔍 loud debug\n");

    if (oldDebug !== undefined) {
      process.env.ANVIL_DEBUG = oldDebug;
    } else {
      delete process.env.ANVIL_DEBUG;
    }
    stderrSpy.mockRestore();
  });
});
