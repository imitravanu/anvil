import { describe, expect, it, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { LspServerCommand } from "../types.js";

// A short request timeout so the hang paths resolve quickly instead of at the
// 15s production default. Latency budget, not a race to win: the child still
// has to boot node and answer initialize, so this must clear process startup.
// Must be set before constants.ts is first loaded.
process.env.ANVIL_LSP_TIMEOUT_MS = "1500";

// Dynamic (not static) import: the env var above has to win the module race.
const { LspStdioClient, getLspClient } = await import("../client.js");

/** Framed server that answers initialize, pushes diagnostics, then hangs. */
const FAKE_PUSH_SERVER = `
const fs = require("node:fs");
const logPath = process.argv[3];
let acc = Buffer.alloc(0);
function log(m) { fs.appendFileSync(logPath, m + "\\n"); }
function send(o) {
  const s = JSON.stringify(o);
  process.stdout.write("Content-Length: " + Buffer.byteLength(s, "utf8") + "\\r\\n\\r\\n" + s);
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
    if (typeof msg.method === "string") log(msg.method);
    if (msg.method === "initialize") {
      send({ jsonrpc: "2.0", id: msg.id, result: { capabilities: {} } });
      send({ jsonrpc: "2.0", method: "textDocument/publishDiagnostics", params: { uri: "file:///tmp/x.ts", diagnostics: [
        { range: { start: { line: 4 } }, severity: 1, message: "err" },
        { range: { start: { line: 9 } }, severity: 2, message: "warn" },
        { range: { start: { line: 0 } }, severity: 3, message: "info" }
      ] } });
    } else if (msg.method === "shutdown") {
      send({ jsonrpc: "2.0", id: msg.id, result: null });
    }
    // every other request is deliberately left unanswered (hang)
  }
}
process.stdin.on("data", (c) => { acc = Buffer.concat([acc, c]); parse(); });
`;

/** Framed server that answers initialize then exits, simulating a crash. */
const FAKE_EXIT_SERVER = `
let acc = Buffer.alloc(0);
function send(o) {
  const s = JSON.stringify(o);
  process.stdout.write("Content-Length: " + Buffer.byteLength(s, "utf8") + "\\r\\n\\r\\n" + s);
}
process.stdin.on("data", (c) => {
  acc = Buffer.concat([acc, c]);
  const h = acc.indexOf("\\r\\n\\r\\n");
  if (h < 0) return;
  const m = Buffer.from(acc.subarray(0, h)).toString("utf8").match(/Content-Length:\\s*(\\d+)/i);
  if (!m) return;
  const len = Number(m[1]);
  if (acc.length < h + 4 + len) return;
  const body = Buffer.from(acc.subarray(h + 4, h + 4 + len)).toString("utf8");
  let msg; try { msg = JSON.parse(body); } catch { return; }
  if (msg.method === "initialize") { send({ jsonrpc: "2.0", id: msg.id, result: { capabilities: {} } }); setTimeout(() => process.exit(0), 30); }
});
`;

/**
 * Framed server that answers initialize and keeps a helper child running.
 * Language servers spawn helpers (indexers, watchers); teardown must sweep the
 * whole process group, not just the direct child. Both pids are logged so the
 * test can prove who actually died.
 */
const FAKE_GROUP_SERVER = `
const fs = require("node:fs");
const { spawn } = require("node:child_process");
const logPath = process.argv[3];
const helper = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
fs.appendFileSync(logPath, "server:" + process.pid + "\\n");
fs.appendFileSync(logPath, "helper:" + helper.pid + "\\n");
let acc = Buffer.alloc(0);
function send(o) {
  const s = JSON.stringify(o);
  process.stdout.write("Content-Length: " + Buffer.byteLength(s, "utf8") + "\\r\\n\\r\\n" + s);
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
    if (msg.method === "initialize") send({ jsonrpc: "2.0", id: msg.id, result: { capabilities: {} } });
    else if (msg.method === "shutdown") send({ jsonrpc: "2.0", id: msg.id, result: null });
  }
}
process.stdin.on("data", (c) => { acc = Buffer.concat([acc, c]); parse(); });
`;

/**
 * Framed server that completes initialize and then claims an oversized frame.
 * The claim alone trips the client's frame cap (no need to write 8 MiB): the
 * client goes dead while this process keeps running — the corpse-drop cleanup
 * must still kill it.
 */
const FAKE_OVERSIZE_SERVER = `
const fs = require("node:fs");
const logPath = process.argv[3];
fs.appendFileSync(logPath, "server:" + process.pid + "\\n");
let acc = Buffer.alloc(0);
function send(o) {
  const s = JSON.stringify(o);
  process.stdout.write("Content-Length: " + Buffer.byteLength(s, "utf8") + "\\r\\n\\r\\n" + s);
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
    if (msg.method === "initialize") {
      send({ jsonrpc: "2.0", id: msg.id, result: { capabilities: {} } });
      setTimeout(() => process.stdout.write("Content-Length: 999999999\\r\\n\\r\\n"), 20);
    } else if (msg.method === "shutdown") send({ jsonrpc: "2.0", id: msg.id, result: null });
  }
}
process.stdin.on("data", (c) => { acc = Buffer.concat([acc, c]); parse(); });
`;

const created: string[] = [];
afterAll(() => {
  for (const d of created) fs.rmSync(d, { recursive: true, force: true });
});

function makeFixture(scriptBody: string, name: string): { root: string; server: LspServerCommand; logPath: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "anvil-lsp-edge-"));
  created.push(root);
  const script = path.join(root, `${name}.cjs`);
  fs.writeFileSync(script, scriptBody, "utf8");
  const logPath = path.join(root, `${name}.log`);
  return {
    root,
    logPath,
    server: { language: "typescript", command: process.execPath, args: [script, "unused", logPath] },
  };
}

async function waitFor(predicate: () => boolean, ms: number): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise<void>((r) => setTimeout(r, 10));
  }
  return predicate();
}

/** First `label:<pid>` line a fixture wrote to its log; null while unwritten. */
function readPid(logPath: string, label: string): number | null {
  if (!fs.existsSync(logPath)) return null;
  const m = fs.readFileSync(logPath, "utf8").match(new RegExp(`${label}:(\\d+)`));
  return m ? Number(m[1]) : null;
}

function isProcessGone(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return false;
  } catch {
    return true;
  }
}

describe("LspStdioClient edge behavior", () => {
  it("collects publishDiagnostics with 1-based lines and mapped severities", async () => {
    const { root, server } = makeFixture(FAKE_PUSH_SERVER, "push-server");
    const client = await LspStdioClient.start(server, root);
    expect(client).not.toBeNull();

    const diags = await client!.waitForDiagnostics(1500);
    expect(diags).toEqual([
      { path: "/tmp/x.ts", line: 5, severity: "error", message: "err" },
      { path: "/tmp/x.ts", line: 10, severity: "warning", message: "warn" },
      { path: "/tmp/x.ts", line: 1, severity: "info", message: "info" },
    ]);

    await client!.close();
  });

  it("degrades to empty results (never throws) when a request times out", async () => {
    const { root, server } = makeFixture(FAKE_PUSH_SERVER, "timeout-server");
    const client = await LspStdioClient.start(server, root);
    expect(client).not.toBeNull();

    const file = path.join(root, "a.ts");
    fs.writeFileSync(file, "const x = 1;\n", "utf8");
    // Issued together: each is its own pending id, so the three timeouts fire
    // on the same wall clock instead of back to back.
    const [defs, refs, hov] = await Promise.all([
      client!.gotoDefinition(file, { line: 1, character: 0 }),
      client!.findReferences(file, { line: 1, character: 0 }),
      client!.hover(file, { line: 1, character: 0 }),
    ]);
    expect(defs).toEqual([]);
    expect(refs).toEqual([]);
    expect(hov).toBeNull();

    await client!.close();
  });

  it("sends didOpen once, then didChange with a bumped version on re-sync", async () => {
    const { root, server, logPath } = makeFixture(FAKE_PUSH_SERVER, "sync-server");
    const client = await LspStdioClient.start(server, root);
    expect(client).not.toBeNull();

    const file = path.join(root, "b.ts");
    client!.ensureOpen(file, "typescript", "const a = 1;\n");
    client!.ensureOpen(file, "typescript", "const a = 2;\n");
    client!.ensureOpen(file, "typescript", "const a = 3;\n");
    // Wait for the FULL sequence: the three ensureOpen calls queue synchronously,
    // but the child parses them across data events, so under full-suite load the
    // second didChange can lag the first one observed.
    const synced = await waitFor(() => {
      if (!fs.existsSync(logPath)) return false;
      const log = fs.readFileSync(logPath, "utf8");
      return (
        (log.match(/textDocument\/didOpen/g) ?? []).length === 1 &&
        (log.match(/textDocument\/didChange/g) ?? []).length === 2
      );
    }, 2000);
    expect(synced).toBe(true);

    const log = fs.readFileSync(logPath, "utf8");
    expect((log.match(/textDocument\/didOpen/g) ?? []).length).toBe(1);
    expect((log.match(/textDocument\/didChange/g) ?? []).length).toBe(2);
    await client!.close();
  });

  it("marks a crashed server dead, fails in-flight calls, and never reuses it", async () => {
    const { root, server } = makeFixture(FAKE_EXIT_SERVER, "exit-server");
    const c1 = await getLspClient(server, root);
    expect(c1).not.toBeNull();
    // The cached client dies on its own shortly after initialize.
    expect(await waitFor(() => c1!.isDead(), 2000)).toBe(true);

    const file = path.join(root, "c.ts");
    fs.writeFileSync(file, "const c = 1;\n", "utf8");
    expect(await c1!.gotoDefinition(file, { line: 1, character: 0 })).toEqual([]);
    expect(await c1!.waitForDiagnostics(50)).toEqual([]);
    // Writing to a dead server's stdin (notify) must be handled, not surface as
    // an unhandled stream EPIPE that takes down the process.
    expect(() => c1!.ensureOpen(file, "typescript", "const c = 2;\n")).not.toThrow();
    expect(c1!.isDead()).toBe(true);

    // The cache sees the corpse and spawns a replacement rather than reusing it.
    const c2 = await getLspClient(server, root);
    expect(c2).not.toBeNull();
    expect(c2).not.toBe(c1);
    await c2!.close();
  });

  it("returns null when the configured server binary cannot be spawned", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "anvil-lsp-edge-"));
    created.push(root);
    const missing: LspServerCommand = { language: "typescript", command: "/definitely/not/a/real-lsp-binary", args: [] };
    expect(await LspStdioClient.start(missing, root)).toBeNull();
  });

  it("does not resurrect STALE diagnostics after a timeout (E3/E10)", async () => {
    const { root, server } = makeFixture(FAKE_PUSH_SERVER, "stale-server");
    const client = await LspStdioClient.start(server, root);
    expect(client).not.toBeNull();
    // The fake server pushes diagnostics for /tmp/x.ts right after initialize.
    const pushed = await client!.waitForDiagnostics(1500);
    expect(pushed.length).toBeGreaterThan(0);
    // Ask only for diagnostics NEWER than any that can exist: the deadline
    // expires and the fallback must return nothing, never the stale entry.
    const stale = await client!.diagnosticsForPath("/tmp/x.ts", Date.now() + 60_000, 60);
    expect(stale).toEqual([]);
    await client!.close();
  });

  it("killSync() hard-stops the server without awaiting (the exit-handler path)", async () => {
    const { root, server, logPath } = makeFixture(FAKE_GROUP_SERVER, "killsync-server");
    const client = await LspStdioClient.start(server, root);
    expect(client).not.toBeNull();
    await waitFor(() => readPid(logPath, "server") !== null, 2000);
    const pid = readPid(logPath, "server");
    expect(pid).not.toBeNull();

    client!.killSync();
    expect(client!.isDead()).toBe(true);
    // SIGKILL is delivered by the syscall inside killSync: the pid must stop
    // existing with no further awaits, because an 'exit' handler has none.
    expect(await waitFor(() => isProcessGone(pid!), 2000)).toBe(true);
  });

  it("close() sweeps server descendants, not just the direct child", async () => {
    const { root, server, logPath } = makeFixture(FAKE_GROUP_SERVER, "group-server");
    const client = await LspStdioClient.start(server, root);
    expect(client).not.toBeNull();
    await waitFor(() => readPid(logPath, "server") !== null, 2000);
    const helper = readPid(logPath, "helper");
    expect(helper).not.toBeNull();

    let helperAlive = true;
    try {
      await client!.close();
      // The helper is in the server's process group: a direct-child SIGTERM
      // leaves it running against the project for the life of the machine.
      helperAlive = !(await waitFor(() => isProcessGone(helper!), 3000));
      expect(helperAlive).toBe(false);
    } finally {
      if (helperAlive) {
        try {
          process.kill(helper!, "SIGKILL"); // cleanup so a RED run never leaks the helper
        } catch {
          // intentional: already gone.
        }
      }
    }
  });

  it("a frame-capped corpse still gets its living server killed when the cache drops it", async () => {
    const { root, server, logPath } = makeFixture(FAKE_OVERSIZE_SERVER, "oversize-server");
    const c1 = await getLspClient(server, root);
    expect(c1).not.toBeNull();
    expect(await waitFor(() => c1!.isDead(), 2000)).toBe(true);
    await waitFor(() => readPid(logPath, "server") !== null, 2000);
    const pid = readPid(logPath, "server");
    expect(pid).not.toBeNull();

    const c2 = await getLspClient(server, root);
    let alive = true;
    try {
      expect(c2).not.toBe(c1);
      // The cache saw the corpse, dropped it, and called close(). Early-
      // returning on `dead` (the old close) skipped the kill, so the server
      // behind a frame-capped client outlived every caller.
      alive = !(await waitFor(() => isProcessGone(pid!), 3000));
      expect(alive).toBe(false);
    } finally {
      if (alive) {
        try {
          process.kill(pid!, "SIGKILL"); // cleanup so a RED run never leaks the server
        } catch {
          // intentional: already gone.
        }
      }
      if (c2) await c2.close();
    }
  });
});
