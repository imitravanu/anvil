import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { AgentSession } from "../agent/session.js";
import { BaseProvider } from "../providers/base.js";
import type { CompletionRequest, StreamEvent } from "../providers/types.js";
import { takeSnapshot } from "../agent/checkpoints.js";
import { describe as describeEdit } from "../tools/editFile.js";
import { execute as executeEdit } from "../tools/editFile.js";
import { describe as describeWrite } from "../tools/writeFile.js";
import { runGoalMission, type GoalTurnOutcome } from "../agent/goal/goalEngine.js";
import { translateAnthropicStream } from "../providers/anthropic.js";
import { resolveProviderSelection } from "../config/index.js";
import { listSessions, loadSession } from "../session/store.js";
import { createSseTransport } from "../mcp/transport.js";
import { registerPluginExecutors } from "../plugins/registry.js";
import { executeTool } from "../tools/index.js";

const dirs: string[] = [];
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "anvil-audit-regression-"));
  dirs.push(root);
  return root;
}
afterEach(async () => { await Promise.all(dirs.splice(0).map(dir => fs.rm(dir, { recursive: true, force: true }))); });
const ctx = (root: string) => ({ projectRoot: root, signal: new AbortController().signal });

describe("2026-10-20 containment and cancellation regressions", () => {
  it.each([
    { content: "abc KEEP THIS TAIL", old: "abc", replacement: "XYZ", error: false, expected: "XYZ KEEP THIS TAIL" },
    { content: "abc tail abc", old: "abc", replacement: "XYZ", error: true, expected: "abc tail abc" },
    { content: "abc 🙂 café", old: "abc", replacement: "XYZ", error: false, expected: "XYZ 🙂 café" },
  ])("reads to EOF after short reads before validating or editing $content", async test => {
    const root = await fixture();
    const file = path.join(root, "short.txt");
    await fs.writeFile(file, test.content);
    const open = fs.open.bind(fs);
    const spy = vi.spyOn(fs, "open").mockImplementation(async (...args) => {
      const handle = await open(...args);
      if (args[0] === file) {
        const read = handle.read.bind(handle);
        handle.read = ((buffer: Buffer, offset: number, length: number, position: number) =>
          read(buffer, offset, Math.min(length, 3), position)) as typeof handle.read;
      }
      return handle;
    });
    try {
      const result = await executeEdit({ path: "short.txt", old_str: test.old, new_str: test.replacement }, ctx(root));
      expect(result.isError).toBe(test.error);
      expect(await fs.readFile(file, "utf8")).toBe(test.expected);
    } finally { spy.mockRestore(); }
  });

  it.each(["text", "buffer"])("refuses a planted %s temporary symlink without changing or removing it", async kind => {
    vi.resetModules();
    const { atomicWriteText, atomicWriteBuffer } = await import("../atomicWrite.js");
    const root = await fixture();
    const target = path.join(root, "target");
    const outside = path.join(root, "outside");
    const temp = `${target}.tmp.${process.pid}.0`;
    await fs.writeFile(target, "original target");
    await fs.writeFile(outside, "outside");
    await fs.symlink(outside, temp);
    const write = kind === "text" ? atomicWriteText(target, "bad") : atomicWriteBuffer(target, Buffer.from("bad"));
    await expect(write).rejects.toMatchObject({ code: "EEXIST" });
    expect(await fs.readFile(outside, "utf8")).toBe("outside");
    expect(await fs.readFile(target, "utf8")).toBe("original target");
    expect((await fs.lstat(temp)).isSymbolicLink()).toBe(true);
  });

  it.each(["snapshot", "preview", "write preview"])("refuses a FIFO in %s preparation without waiting for a writer", async kind => {
    if (process.platform === "win32") return; // POSIX FIFOs have no Windows equivalent.
    const root = await fixture();
    const fifo = path.join(root, "pipe");
    execFileSync("mkfifo", [fifo]);
    const pending = kind === "snapshot" ? takeSnapshot(root, 1, ["pipe"])
      : kind === "preview" ? describeEdit({ path: "pipe", old_str: "a", new_str: "b" }, ctx(root))
      : describeWrite({ path: "pipe", content: "b" }, ctx(root));
    const outcome = await Promise.race([pending.then(() => "settled"), new Promise(resolve => setTimeout(() => resolve("blocked"), 250))]);
    if (outcome === "blocked") await fs.writeFile(fifo, "a"); // Release the pre-fix reader before failing.
    await pending;
    expect(outcome).toBe("settled");
  });

  it("normalizes an abort from the provider base to one cancelled event", async () => {
    class AbortProvider extends BaseProvider {
      readonly id = "openai" as const;
      readonly displayName = "fixture";
      isConfigured() { return true; }
      protected async *doStream(request: CompletionRequest): AsyncGenerator<StreamEvent> {
        yield { type: "text_delta", text: "partial" };
        if (request.signal?.aborted) throw new Error("Request aborted");
        await new Promise((_, reject) => request.signal?.addEventListener("abort", () => reject(new Error("Request aborted")), { once: true }));
      }
    }
    const root = await fixture();
    const session = new AgentSession(new AbortProvider(), { systemPrompt: "test", model: "fixture", maxTokens: 100, projectRoot: root, permissionBroker: { async requestPermission() { return false; } } });
    const iter = session.send("test");
    await iter.next();
    session.cancel();
    const events = [];
    for await (const event of iter) events.push(event);
    expect(events).toEqual([{ type: "cancelled" }]);
  });
});

const ok = (text: string): GoalTurnOutcome => ({ text, cancelled: false, errored: false, verificationFailed: false, permissionDenied: false });
async function mission(root: string, outcomes: GoalTurnOutcome[], maxTurns = 10) {
  let calls = 0;
  const generator = runGoalMission("fixture", { projectRoot: root, summarizeChanges: async () => [], sendTurn: async function* () { return outcomes[calls++] ?? ok("YES — done"); } }, maxTurns);
  let event = await generator.next();
  while (!event.done) event = await generator.next();
  return { result: event.value, calls };
}
const plan = () => ok('[{"id":"1","title":"fixture","criteria":"tests pass"}]');

describe("2026-10-20 mission and persisted-state regressions", () => {
  it.each(["errored", "verificationFailed", "permissionDenied"] as const)("fails a YES review whose %s signal is set", async flag => {
    const { result } = await mission(await fixture(), [plan(), ok("implemented"), { ...ok("YES — done"), [flag]: true }, ok("critique")]);
    expect(result.success).toBe(false);
    expect(result.milestones[0].status).toBe("failed");
  });

  it("does not report success when the final critique fails", async () => {
    const { result } = await mission(await fixture(), [plan(), ok("implemented"), ok("YES — done"), { ...ok("critique"), errored: true }]);
    expect(result.success).toBe(false);
  });

  it.each([1, 2, 3, 4, 5])("never dispatches more than %s mission turns, including critique retries", async maxTurns => {
    const { result, calls } = await mission(await fixture(), [plan(), ok("implemented"), ok("YES — done"), ok(""), ok("retry")], maxTurns);
    expect(calls).toBeLessThanOrEqual(maxTurns);
    expect(result.totalTurns).toBe(calls);
  });

  it("skips malformed session metadata before sorting or restoring", async () => {
    const root = await fixture();
    for (const id of ["one", "two"]) await fs.writeFile(path.join(root, `${id}.json`), JSON.stringify({ metadata: { id, updatedAt: 123 }, history: [] }));
    expect(listSessions(root)).toEqual([]);
    expect(loadSession("one", root)).toBeNull();
  });

  it("a provider-only override does not replay another provider's saved model", () => {
    const selection = resolveProviderSelection({ flagProvider: "anthropic", settings: { defaultProviderId: "gemini", defaultModel: "gemini-3.6-flash" }, creds: { anthropicApiKey: "fixture", geminiApiKey: "fixture" } });
    expect(selection?.providerId).toBe("anthropic");
    expect(selection?.model).not.toBe("gemini-3.6-flash");
  });
});

describe("2026-10-20 provider, transport and plugin regressions", () => {
  it("counts cache creation and reads in Anthropic total input", async () => {
    async function* raw() {
      yield { type: "message_start", message: { usage: { input_tokens: 10, cache_read_input_tokens: 10000, cache_creation_input_tokens: 5000 } } };
      yield { type: "message_delta", usage: { output_tokens: 7 }, delta: { stop_reason: "end_turn" } };
    }
    const events = [];
    for await (const event of translateAnthropicStream(raw())) events.push(event);
    expect(events.find(event => event.type === "usage")).toMatchObject({ inputTokens: 15010, cachedInputTokens: 10000, outputTokens: 7 });
  });

  it("uses the last cumulative Anthropic usage once rather than adding snapshots", async () => {
    async function* raw() {
      yield { type: "message_start", message: { usage: { input_tokens: 10, cache_read_input_tokens: 100 } } };
      yield { type: "message_delta", usage: { input_tokens: 20, cache_read_input_tokens: 200, cache_creation_input_tokens: 30, output_tokens: 4 } };
      yield { type: "message_delta", usage: { input_tokens: 25, output_tokens: 7 }, delta: { stop_reason: "end_turn" } };
    }
    const events = [];
    for await (const event of translateAnthropicStream(raw())) events.push(event);
    expect(events.filter(event => event.type === "usage")).toEqual([{ type: "usage", inputTokens: 255, outputTokens: 7, cachedInputTokens: 200, cacheCreationInputTokens: 30 }]);
  });

  it("delivers the final inline SSE POST frame", async () => {
    let streamController!: ReadableStreamDefaultController<Uint8Array>;
    const stream = new ReadableStream<Uint8Array>({ start(controller) { streamController = controller; controller.enqueue(new TextEncoder().encode("event: endpoint\ndata: /rpc\n\n")); } });
    const fetchImpl: typeof fetch = async (_url, init) => init?.method === "GET"
      ? new Response(stream, { headers: { "content-type": "text/event-stream" } })
      : new Response('event: message\ndata: {"id":7,"result":{}}\n\n', { headers: { "content-type": "text/event-stream" } });
    const transport = await createSseTransport("https://fixture.invalid/sse", { fetchImpl, timeoutMs: 1000 });
    try {
      const response = transport.lines()[Symbol.asyncIterator]().next();
      transport.send('{"id":7,"method":"test"}');
      const value = await Promise.race([response, new Promise(resolve => setTimeout(() => resolve("timeout"), 250))]);
      expect(value).toMatchObject({ value: '{"id":7,"result":{}}' });
    } finally { transport.close(); streamController.close(); }
  });

  it("keeps plugin execution responsive to timers and cancellation", async () => {
    const root = await fixture();
    registerPluginExecutors([{ dir: root, enabled: true, manifest: { name: "auditresponsive", version: "1", tools: [{ name: "wait", description: "fixture", command: process.execPath, args: ["-e", "setTimeout(()=>console.log('finished'),500)"] }] } }]);
    const controller = new AbortController();
    let timerFired = false;
    const timer = setTimeout(() => { timerFired = true; controller.abort(); }, 30);
    try {
      const result = await executeTool("plugin_auditresponsive__wait", {}, { projectRoot: root, signal: controller.signal });
      expect(timerFired).toBe(true);
      expect(result.isError).toBe(true);
      expect(JSON.stringify(result.output)).not.toContain("finished");
    } finally { clearTimeout(timer); }
  });

  it("terminates pathological grep work without blocking the caller", async () => {
    const root = await fixture();
    await fs.writeFile(path.join(root, "killer.txt"), "a".repeat(60) + "!");
    // A subprocess deadline makes this regression safe against the pre-fix synchronous engine.
    const script = `import {execute} from ${JSON.stringify(path.resolve("src/tools/grep.ts"))}; const r=await execute({pattern:'^(a|aa){40}$'},{projectRoot:${JSON.stringify(root)},signal:new AbortController().signal}); if(!r.isError || !String(r.output.error).includes('regex execution timed out'))process.exitCode=2;`;
    expect(() => execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], { timeout: 4500, env: { ...process.env, ANVIL_GREP_REGEX_TIMEOUT_MS: "100" } })).not.toThrow();
  });
});
