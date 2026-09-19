import { afterEach, describe, expect, it } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import {
  MAX_MCP_LINE_BYTES,
  SseFrameParser,
  createSseTransport,
  sanitizeSseUrl,
} from "../transport.js";
import { callTool, connectServer, reconnectServerConnection } from "../client.js";
import type { ValidatedMcpServer } from "../../config/mcp.js";
import { getErrorMessage } from "../../errors.js";

describe("SseFrameParser", () => {
  it("parses endpoint + message frames across chunk splits and CRLF", () => {
    const parser = new SseFrameParser();
    const out = [
      ...parser.push("event: endpo"),
      ...parser.push("int\r\ndata: /rpc\r\n\r\n: keepalive\n"),
      ...parser.push("\nevent: message\r\ndata: {\"a\":1}\r\n\r\n"),
    ];
    expect(out).toEqual([
      { event: "endpoint", data: "/rpc" },
      { event: "message", data: '{"a":1}' },
    ]);
  });

  it("joins repeated data lines and ignores comments", () => {
    const parser = new SseFrameParser();
    const out = parser.push(": ping\n\ndata: one\ndata: two\n\n");
    expect(out).toEqual([{ event: "message", data: "one\ntwo" }]);
  });

  it("holds a trailing CR that may split a CRLF", () => {
    const parser = new SseFrameParser();
    expect(parser.push("event: message\r")).toEqual([]);
    expect(parser.push("\ndata: hi\r\n\r\n")).toEqual([{ event: "message", data: "hi" }]);
  });
});

describe("sanitizeSseUrl", () => {
  it("strips credentials, query, and fragment", () => {
    expect(sanitizeSseUrl("https://user:pass@host:8443/sse?token=secret#x")).toBe(
      "https://host:8443/sse"
    );
    expect(sanitizeSseUrl("not a url")).toBe("(invalid url)");
  });
});

interface FakeSse {
  url: string;
  close: () => Promise<void>;
}

interface FakeSseOpts {
  /** Override the advertised POST target (used to probe the origin policy). */
  endpoint?: string;
  /** Answer `tools/call` with a body far past the client's read cap. */
  oversizedPost?: boolean;
}

/** Legacy-profile SSE server: GET /sse yields an endpoint event, POST /rpc answers JSON-RPC inline. */
function startFakeSseServer(opts: FakeSseOpts = {}): Promise<FakeSse> {
  const streams: http.ServerResponse[] = [];
  const server = http.createServer((req, res) => {
    if (req.method === "GET" && (req.url === "/sse" || req.url?.startsWith("/sse?"))) {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      res.write(`event: endpoint\ndata: ${opts.endpoint ?? "/rpc"}\n\n`);
      streams.push(res);
      req.on("close", () => {
        const i = streams.indexOf(res);
        if (i >= 0) streams.splice(i, 1);
      });
      return;
    }
    if (req.method === "POST" && req.url === "/rpc") {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
      });
      req.on("end", () => {
        let msg: { id?: unknown; method?: unknown; params?: { arguments?: unknown } } = {};
        try {
          const parsed: unknown = JSON.parse(body);
          if (typeof parsed === "object" && parsed !== null) {
            msg = parsed as { id?: unknown; method?: unknown; params?: { arguments?: unknown } };
          }
        } catch {
          res.writeHead(400);
          res.end();
          return;
        }
        if (msg.id === undefined) {
          res.writeHead(202); // notification — answer (if any) arrives on the stream
          res.end();
          return;
        }
        const respond = (result: unknown) => {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result }));
        };
        if (msg.method === "initialize") {
          respond({ protocolVersion: "2025-11-25", capabilities: {}, serverInfo: { name: "fake-sse", version: "0.0.1" } });
        } else if (msg.method === "tools/list") {
          respond({ tools: [{ name: "ping", description: "pong tool", inputSchema: { type: "object", properties: {} } }] });
        } else if (msg.method === "tools/call") {
          if (opts.oversizedPost) {
            // Bounded-read probe: the body is well past the client's cap, so the
            // client must abandon it mid-stream instead of buffering it whole.
            res.on("error", () => {
              // intentional: the client hangs up mid-write, by design of this probe
            });
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(
              JSON.stringify({
                jsonrpc: "2.0",
                id: msg.id,
                result: { content: [{ type: "text", text: "x".repeat(MAX_MCP_LINE_BYTES + 4096) }] },
              })
            );
            return;
          }
          const args = msg.params?.arguments ?? {};
          respond({ content: [{ type: "text", text: `pong:${JSON.stringify(args)}` }] });
        } else {
          respond({});
        }
      });
      return;
    }
    res.writeHead(404);
    res.end();
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${port}/sse`,
        close: () =>
          new Promise<void>((done) => {
            for (const s of streams) {
              try {
                s.end();
              } catch {
                // ignore teardown races
              }
            }
            // A stream this probe deliberately abandoned would otherwise keep
            // the server's close() waiting forever.
            server.closeAllConnections();
            server.close(() => done());
          }),
      });
    });
  });
}

interface SilentSse {
  url: string;
  /** Streams the server believes are still open. */
  openStreams: () => number;
  close: () => Promise<void>;
}

/**
 * A server that accepts the connection and then says nothing useful.
 * `sendHeaders: false` never answers the GET at all (the connect itself must
 * be bounded); the default completes the GET handshake and never sends an
 * endpoint frame (the opened stream must be released).
 */
function startSilentSseServer(opts: { sendHeaders?: boolean } = {}): Promise<SilentSse> {
  let open = 0;
  const server = http.createServer((req, res) => {
    if (req.method === "GET") {
      open += 1;
      req.on("close", () => {
        open -= 1;
      });
      if (opts.sendHeaders !== false) {
        res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
        // Flush headers only: the client's fetch resolves, then waits for an
        // endpoint frame this server never writes.
        res.flushHeaders();
      }
      return;
    }
    res.writeHead(404);
    res.end();
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${port}/sse`,
        openStreams: () => open,
        close: () =>
          new Promise<void>((done) => {
            server.closeAllConnections();
            server.close(() => done());
          }),
      });
    });
  });
}

function sseCfg(url: string): ValidatedMcpServer {
  return { id: "sse-fake", transport: "sse", command: "", args: [], env: {}, url, headers: {}, timeoutMs: 5000 };
}

describe("SSE transport end-to-end (Phase 25.1)", () => {
  let fake: FakeSse | null = null;
  let silent: SilentSse | null = null;
  afterEach(async () => {
    if (fake) await fake.close();
    fake = null;
    if (silent) await silent.close();
    silent = null;
  });

  it("handshakes via endpoint event and lists tools", async () => {
    fake = await startFakeSseServer();
    const transport = await createSseTransport(fake.url, { timeoutMs: 5000 });
    try {
      const conn = await connectServer("sse-fake", sseCfg(fake.url), transport, { timeoutMs: 5000 });
      expect(conn.status).toBe("ready");
      expect(conn.tools.map((t) => t.name)).toEqual(["ping"]);
    } finally {
      transport.close();
    }
  });

  it("calls tools with request/response semantics", async () => {
    fake = await startFakeSseServer();
    const transport = await createSseTransport(fake.url, { timeoutMs: 5000 });
    try {
      const conn = await connectServer("sse-fake", sseCfg(fake.url), transport, { timeoutMs: 5000 });
      expect(conn.status).toBe("ready");
      const res = await callTool(conn, "ping", { n: 1 });
      expect(res.isError).toBe(false);
      expect(JSON.stringify(res.output)).toContain("pong");
    } finally {
      transport.close();
    }
  });

  it("reconnects a dead SSE connection (24.2 path, transport-agnostic)", async () => {
    fake = await startFakeSseServer();
    const transport = await createSseTransport(fake.url, { timeoutMs: 5000 });
    const conn = await connectServer("sse-fake", sseCfg(fake.url), transport, { timeoutMs: 5000 });
    expect(conn.status).toBe("ready");
    try {
      conn.transport?.close();
      conn.status = "error";
      const ok = await reconnectServerConnection(conn, { timeoutMs: 5000 });
      expect(ok).toBe(true);
      expect(conn.status).toBe("ready");
    } finally {
      try {
        conn.transport?.close();
      } catch {
        // ignore teardown races
      }
    }
  });

  it("fails within budget with a credential-free error when unreachable", async () => {
    const secret = "http://127.0.0.1:1/sse?token=shh-secret";
    let thrown = "";
    try {
      await createSseTransport(secret, { timeoutMs: 1500 });
    } catch (err: unknown) {
      thrown = getErrorMessage(err);
    }
    expect(thrown).toMatch(/failed/i);
    expect(thrown).not.toContain("shh-secret");
  });

  it("bounds the connect itself when the server never answers the GET", async () => {
    silent = await startSilentSseServer({ sendHeaders: false });
    const started = Date.now();
    let thrown = "";
    try {
      await createSseTransport(silent.url, { timeoutMs: 300 });
    } catch (err: unknown) {
      thrown = getErrorMessage(err);
    }
    expect(thrown).toMatch(/timed out|endpoint|failed/i);
    // Pre-fix this never returned: the deadline was installed only AFTER the
    // GET resolved, so an unanswered GET had nothing to abort it.
    expect(Date.now() - started).toBeLessThan(2000);
    await new Promise((r) => setTimeout(r, 50));
    expect(silent.openStreams()).toBe(0);
  });

  it("fails within the budget when the server never sends an endpoint frame", async () => {
    silent = await startSilentSseServer();
    const started = Date.now();
    let thrown = "";
    try {
      await createSseTransport(silent.url, { timeoutMs: 300 });
    } catch (err: unknown) {
      thrown = getErrorMessage(err);
    }
    expect(thrown).toMatch(/timed out|endpoint/i);
    expect(Date.now() - started).toBeLessThan(2000);
    // Zero retained streams: the client aborted the connection it opened.
    await new Promise((r) => setTimeout(r, 50));
    expect(silent.openStreams()).toBe(0);
  });

  it("refuses an off-origin endpoint instead of POSTing our credentials there", async () => {
    fake = await startFakeSseServer({ endpoint: "https://evil.invalid/rpc" });
    const started = Date.now();
    let thrown = "";
    try {
      await createSseTransport(fake.url, {
        timeoutMs: 5000,
        headers: { Authorization: "Bearer super-secret" },
      });
    } catch (err: unknown) {
      thrown = getErrorMessage(err);
    }
    expect(thrown).toMatch(/off-origin/i);
    // Terminal rather than retried, and the header value never leaks into it.
    expect(Date.now() - started).toBeLessThan(1000);
    expect(thrown).not.toContain("super-secret");
  });

  it("abandons an oversized POST response while reading it", async () => {
    fake = await startFakeSseServer({ oversizedPost: true });
    const transport = await createSseTransport(fake.url, { timeoutMs: 5000 });
    try {
      const conn = await connectServer("sse-fake", sseCfg(fake.url), transport, { timeoutMs: 5000 });
      expect(conn.status).toBe("ready");
      const res = await callTool(conn, "ping", { n: 1 });
      // Failing the transport is the honest outcome: the response could not be
      // read within the cap, so the call errors as closed.
      expect(res.isError).toBe(true);
    } finally {
      transport.close();
    }
  });
});
