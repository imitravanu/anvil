import { describe, expect, it } from "vitest";
import {
  MAX_READ_FILE_BYTES,
  RUN_COMMAND_TIMEOUT_MS,
  MAX_STREAM_BYTES,
  FALLBACK_CONTEXT_WINDOW,
  COMPACTION_THRESHOLD,
  KEEP_RECENT_MESSAGES,
  MAX_VERIFY_REPAIRS,
  DEFAULT_MAX_INNER_ITERATIONS,
  CHECKPOINT_KEEP,
  DEFAULT_MCP_REQUEST_TIMEOUT_MS,
  SUB_AGENT_REPORT_MAX_CHARS,
} from "../constants.js";

describe("Centralized Constants (Phase 24.9)", () => {
  it("exports typed core operational constants with expected defaults", () => {
    expect(MAX_READ_FILE_BYTES).toBe(512 * 1024);
    expect(RUN_COMMAND_TIMEOUT_MS).toBe(120_000);
    expect(MAX_STREAM_BYTES).toBe(20 * 1024);
    expect(FALLBACK_CONTEXT_WINDOW).toBe(32_000);
    expect(COMPACTION_THRESHOLD).toBe(0.75);
    expect(KEEP_RECENT_MESSAGES).toBe(6);
    expect(MAX_VERIFY_REPAIRS).toBe(2);
    expect(DEFAULT_MAX_INNER_ITERATIONS).toBe(20);
    expect(CHECKPOINT_KEEP).toBe(5);
    expect(DEFAULT_MCP_REQUEST_TIMEOUT_MS).toBe(30_000);
    expect(SUB_AGENT_REPORT_MAX_CHARS).toBe(8000);
  });
});
