import { describe, expect, it, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getLspClient } from "../client.js";
import type { LspServerCommand } from "../types.js";

// A tiny fake LSP server run as a child `node` process. It speaks the same
// Content-Length framing as the client, records every method it receives to a
// log file, answers initialize/shutdown, and returns a canned definition.
const FAKE_SERVER = `
const fs = require("node:fs");
const logPath = process.argv[3];
function logMethod(m) { fs.appendFileSync(logPath, m + "\\n"); }
let acc = Buffer.alloc(0);
function send(obj) {
  const s = JSON.stringify(obj);
  const frame = "Content-Length: " + Buffer.byteLength(s, "utf8") + "\\r\\n\\r\\n" + s;
  process.stdout.write(frame);
}
function parse() {
  for (;;) {
    const h = acc.indexOf("\\r\\n\\r\\n");
    if (h < 0) return;
    const m = Buffer.from(acc.subarray(0, h)).toString("utf8").match(/Content-Length:\\s*(\\d+)/i);
    if (!m) { acc = acc.subarray(h + 4); continue; }
    const len = Number(m[1]);
    if (acc.length < h + 4 + len) return;
    const body = Buffer.from(acc.subarray(h + 4, h + 4 + len)).toString("utf8");
    acc = acc.subarray(h + 4 + len);
    let msg; try { msg = JSON.parse(body); } catch { continue; }
    if (typeof msg.method === "string") logMethod(msg.method);
    if (msg.method === "initialize") send({ jsonrpc: "2.0", id: msg.id, result: { capabilities: {} } });
    else if (msg.method === "shutdown") send({ jsonrpc: "2.0", id: msg.id, result: null });
    else if (msg.method === "textDocument/definition") {
      send({ jsonrpc: "2.0", id: msg.id, result: [{ uri: "file:///src/answer.ts", range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } } }] });
    }
  }
}
process.stdin.on("data", (c) => { acc = Buffer.concat([acc, c]); parse(); });
`;

const created: string[] = [];

afterAll(() => {
  for (const d of created) fs.rmSync(d, { recursive: true, force: true });
});

describe("LspStdioClient live against a fake framed server", () => {
  it("opens the document (didOpen) and reuses one cached server across calls (A1/A2)", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "anvil-lsp-live-"));
    created.push(root);
    const script = path.join(root, "fake-lsp.cjs");
    fs.writeFileSync(script, FAKE_SERVER, "utf8");
    const logPath = path.join(root, "messages.log");
    const server: LspServerCommand = { language: "typescript", command: process.execPath, args: [script, "unused", logPath] };

    // A2: the cache returns the SAME instance for two acquires — one spawn.
    const c1 = await getLspClient(server, root);
    expect(c1).not.toBeNull();
    const c2 = await getLspClient(server, root);
    expect(c2).toBe(c1);

    // A1: opening the document must reach the server as a textDocument/didOpen,
    // and a definition lookup must produce a location.
    const file = path.join(root, "a.ts");
    fs.writeFileSync(file, "const x = 1;\n", "utf8");
    c1!.ensureOpen(file, "typescript", "const x = 1;\n");
    const locs = await c1!.gotoDefinition(file, { line: 1, character: 5 });
    expect(locs.length).toBeGreaterThan(0);

    await c1!.close();

    const log = fs.readFileSync(logPath, "utf8");
    // Spawned exactly once across two getLspClient calls (cache reuse).
    expect((log.match(/^initialize$/gm) ?? []).length).toBe(1);
    expect(log).toContain("textDocument/didOpen");
    expect(log).toContain("textDocument/definition");
  });
});