import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { StreamEvent } from "../../providers/types.js";
import { FakeProvider } from "./fakeProvider.js";
import { AUTO_APPROVE_BROKER } from "../types.js";
import { AgentSession, type AgentEvent, type AgentOptions } from "../index.js";
import { TOOL_DEFINITIONS, executeTool, registerExternalExecutor } from "../../tools/index.js";
import {
  MCP_TOOL_PREFIX,
  createMcpExecutor,
  describeMcpInput,
  dropCollidingMcpTools,
  toToolDefinitions,
} from "../../tools/mcpTools.js";
import { McpClient, type McpServerConnection } from "../../mcp/client.js";
import { FakeMcpTransport } from "../../mcp/__tests__/fakeMcpTransport.js";

// ---------------------------------------------------------------------------
// Phase 10 (M1–M4 session-level) — FakeProvider + fake MCP transport.
// No network, no real servers.
// ---------------------------------------------------------------------------

const BASE_OPTIONS: Omit<AgentOptions, "projectRoot" | "tools"> = {
  systemPrompt: "",
  model: "phase10-fake",
  maxTokens: 512,
  permissionBroker: AUTO_APPROVE_BROKER,
};

function mcpTurn(name: string, input: unknown, id: string): StreamEvent[] {
  return [
    { type: "tool_call_end", id, name, input },
    { type: "usage", inputTokens: 120, outputTokens: 12 },
    { type: "turn_end", stopReason: "tool_use" },
  ];
}

function textTurn(text = "Done."): StreamEvent[] {
  return [
    { type: "text_delta", text },
    { type: "usage", inputTokens: 80, outputTokens: 30 },
    { type: "turn_end", stopReason: "end_turn" },
  ];
}

function fakeServer(answer: unknown = { content: "mcp-answer" }): {
  conns: Map<string, McpServerConnection>;
  transport: FakeMcpTransport;
} {
  const transport = new FakeMcpTransport((method) => {
    if (method === "initialize") return { protocolVersion: "x" };
    if (method === "tools/list") return { tools: [] };
    if (method === "tools/call") return answer;
    throw new Error("unexpected");
  });
  const client = new McpClient(transport);
  const conn: McpServerConnection = {
    id: "srv",
    status: "ready",
    timeoutMs: 1000,
    tools: [
      { serverId: "srv", name: "lookup", description: "Look up", inputSchema: { type: "object" }, readOnly: true },
      { serverId: "srv", name: "store", description: "Store", inputSchema: { type: "object" }, readOnly: false },
    ],
    client,
  };
  return { conns: new Map([["srv", conn]]), transport };
}

// Global fallback registration (module state, like the CLI boot does once).
const { conns } = fakeServer();
registerExternalExecutor(
  MCP_TOOL_PREFIX,
  createMcpExecutor(() => conns),
  describeMcpInput
);
const MCP_DEFS = dropCollidingMcpTools(
  TOOL_DEFINITIONS.map((d) => d.name),
  toToolDefinitions("srv", conns.get("srv")!.tools)
).kept;

describe("Phase 10 (M1–M4) — MCP in the agent loop", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "anvil-p10-"));
  });
  afterEach(() => {
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  function collect(
    script: StreamEvent[][],
    extra: Partial<AgentOptions> = {}
  ): Promise<{ session: AgentSession; events: AgentEvent[]; provider: FakeProvider }> {
    const provider = new FakeProvider(script);
    const session = new AgentSession(provider, {
      ...BASE_OPTIONS,
      projectRoot: tmp,
      tools: [...TOOL_DEFINITIONS, ...MCP_DEFS],
      ...extra,
    });
    return (async () => {
      const events: AgentEvent[] = [];
      for await (const event of session.send("Use the tools.")) events.push(event);
      return { session, events, provider };
    })();
  }

  it("M1: MCP defs reach the provider with schema intact", async () => {
    const script: StreamEvent[][] = [mcpTurn("mcp_srv__lookup", { q: "x" }, "m0"), textTurn()];
    const { provider } = await collect(script);
    const tools = provider.calls[0].tools as { name: string; inputSchema?: unknown }[];
    const def = tools.find((t) => t.name === "mcp_srv__lookup");
    expect(def).toBeTruthy();
    expect(def!.inputSchema).toEqual({ type: "object" });
  });

  it("M2: round-trip returns content as a non-error tool_result + ledger", async () => {
    const script: StreamEvent[][] = [mcpTurn("mcp_srv__lookup", { q: "x" }, "m0"), textTurn()];
    const { session, events } = await collect(script);
    const finished = events.filter((e) => e.type === "tool_finished");
    expect(finished).toHaveLength(1);
    expect(finished[0].result.isError).toBe(false);
    expect(JSON.stringify(finished[0].result.output)).toContain("mcp-answer");
    const ledger = session.getRunLedger();
    expect(ledger.some((e) => e.eventType === "tool_finished" && e.tool === "mcp_srv__lookup")).toBe(true);
  });

  it("M3: mutating MCP tool forces the batch serial", async () => {
    const inFile = path.join(tmp, "in.txt");
    fs.writeFileSync(inFile, "hello");
    const script: StreamEvent[][] = [
      [
        { type: "tool_call_end", id: "r0", name: "read_file", input: { path: inFile } },
        { type: "tool_call_end", id: "m0", name: "mcp_srv__store", input: { v: 1 } },
        { type: "turn_end", stopReason: "tool_use" },
      ],
      textTurn(),
    ];
    const { events } = await collect(script);
    const seq = events
      .filter((e) => e.type === "tool_started" || e.type === "tool_finished")
      .map((e) => (e.type === "tool_started" ? `start:${e.name}` : `done:${e.name}`));
    expect(seq).toEqual(["start:read_file", "done:read_file", "start:mcp_srv__store", "done:mcp_srv__store"]);
  });

  it("M4: dead-server tool errors cleanly, unknown names still error", async () => {
    conns.get("srv")!.status = "error";
    conns.get("srv")!.error = "connection lost";
    try {
      const script: StreamEvent[][] = [mcpTurn("mcp_srv__lookup", {}, "m0"), textTurn()];
      const { events } = await collect(script);
      const finished = events.filter((e) => e.type === "tool_finished");
      expect(finished).toHaveLength(1);
      expect(finished[0].result.isError).toBe(true);
      expect(JSON.stringify(finished[0].result.output)).toContain("connection lost");
    } finally {
      conns.get("srv")!.status = "ready";
      delete conns.get("srv")!.error;
    }
    const never = new AbortController().signal;
    const unknown = await executeTool("definitely_not_a_tool", {}, { projectRoot: tmp, signal: never });
    expect(unknown.isError).toBe(true);
  });
});
