import { describe, expect, it } from "vitest";
import { formatMcpStatus } from "../mcp.js";
import type { McpServerConnection } from "@anvil/core";

const ready: McpServerConnection = {
  id: "fs",
  status: "ready",
  timeoutMs: 1000,
  tools: [
    { serverId: "fs", name: "read", description: "", inputSchema: {}, readOnly: true },
    { serverId: "fs", name: "write", description: "", inputSchema: {}, readOnly: false },
  ],
};
const broken: McpServerConnection = { id: "db", status: "error", error: "spawn ENOENT", tools: [], timeoutMs: 1000 };

describe("formatMcpStatus", () => {
  it("reports empty config with guidance", () => {
    const out = formatMcpStatus([]);
    expect(out).toContain("No MCP servers configured");
    expect(out).toContain("mcp.json");
  });

  it("shows per-server health, counts, notices, and the honesty line", () => {
    const out = formatMcpStatus([ready, broken], ["MCP remote: v1 is stdio-only"]);
    expect(out).toContain("✓ fs: ready — 2 tools");
    expect(out).toContain("✗ db: error — spawn ENOENT");
    expect(out).toContain("⚠ MCP remote: v1 is stdio-only");
    expect(out).toContain("can't be undone");
  });
});
