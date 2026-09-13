import { describe, expect, it } from "vitest";
import { callTool, McpServerConnection, reconnectServerConnection } from "../client.js";

describe("MCP Client - Auto Reconnection (Phase 24.2)", () => {
  it("exports reconnectServerConnection function", () => {
    expect(typeof reconnectServerConnection).toBe("function");
  });

  it("handles callTool on a dead transport without serverConfig gracefully", async () => {
    let calls = 0;
    const fakeClient = {
      request: async () => {
        calls++;
        if (calls === 1) {
          throw new Error("transport closed");
        }
        return { content: [{ type: "text", text: "recovered" }] };
      },
    } as unknown as import("../client.js").McpClient;

    const conn: McpServerConnection = {
      id: "reconnecting-srv",
      status: "ready",
      tools: [{ serverId: "reconnecting-srv", name: "ping", description: "", inputSchema: {}, readOnly: true }],
      client: fakeClient,
      timeoutMs: 1000,
    };

    const res = await callTool(conn, "ping", {});
    // Without serverConfig, cannot reconnect, returns error
    expect(res.isError).toBe(true);
    expect((res.output as { error: string }).error).toContain("transport closed");
  });

  it("handles reconnect failure gracefully and retains error status", async () => {
    const conn: McpServerConnection = {
      id: "failing-srv",
      status: "error",
      tools: [],
      timeoutMs: 1000,
      serverConfig: {
        id: "failing-srv",
        transport: "stdio",
        command: "non_existent_binary_for_test_12345",
        args: [],
        env: {},
        url: "",
        headers: {},
        timeoutMs: 500,
      },
    };

    const reconnected = await reconnectServerConnection(conn, { timeoutMs: 500 });
    expect(reconnected).toBe(false);
    expect(conn.status).toBe("error");
    expect(conn.error).toBeDefined();
  });
});