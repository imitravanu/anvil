import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AgentSession, type AgentEvent, type AgentOptions } from "../index.js";
import { FakeProvider } from "./fakeProvider.js";
import type { StreamEvent } from "../../providers/types.js";
import { rateLimitRetrySeconds, getCircuitState } from "../../providers/freeModels.js";

let root: string;
beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "anvil-retry-"));
});
afterAll(() => fs.rm(root, { recursive: true, force: true }));

function makeSession(script: Parameters<typeof FakeProvider.prototype.streamCompletion extends never ? never : any> extends never ? never : any) {
  const provider = new (FakeProvider as any)(script);
  const session = new AgentSession(provider as any, {
    systemPrompt: "test",
    model: "fake-model",
    maxTokens: 1024,
    projectRoot: root,
    permissionBroker: { async requestPermission() { return true; } },
  });
  return { provider, session };
}

describe("automatic rate-limit retry", () => {
  it("waits out the window and retries the turn once", async () => {
    const four29: StreamEvent[] = [
      { type: "error", message: "429 quota exceeded. Please retry in 1s." },
    ];
    const good: StreamEvent[] = [
      { type: "text_delta", text: "Recovered." },
      { type: "turn_end", stopReason: "end_turn" },
    ];
    const { provider, session } = makeSession([four29, good]);

    const events: AgentEvent[] = [];
    for await (const e of session.send("hi")) events.push(e);

    const types = events.map((e) => e.type);
    expect(types).toContain("rate_limit_wait");
    const wait = events.find((e) => e.type === "rate_limit_wait") as { seconds: number };
    expect(wait.seconds).toBe(1);
    expect(types).toContain("turn_complete"); // the retry completed the turn
    expect(types).not.toContain("error");
    expect(provider.calls).toHaveLength(2);

    // History is clean: user + assistant text — the failed attempt left nothing.
    const history = session.getHistory();
    expect(history).toHaveLength(2);
    expect(history[1].content).toEqual([{ type: "text", text: "Recovered." }]);
  });

  it("surfaces a second rate limit as a normal error (no infinite retry)", async () => {
    const four29 = (): StreamEvent[] => [
      { type: "error", message: "429 quota exceeded. Please retry in 1s." },
    ];
    const { provider, session } = makeSession([four29(), four29()]);

    const events: AgentEvent[] = [];
    for await (const e of session.send("hi")) events.push(e);

    expect(events.filter((e) => e.type === "rate_limit_wait")).toHaveLength(1);
    expect(events.filter((e) => e.type === "error")).toHaveLength(1);
    expect(provider.calls).toHaveLength(2);
  });

  it("parses and clamps retry windows", () => {
    expect(rateLimitRetrySeconds("Please retry in 53.246s")).toBe(54);
    expect(rateLimitRetrySeconds("429 too many requests")).toBe(20); // conservative default
    expect(rateLimitRetrySeconds("retry in 99999s")).toBe(120); // never park the turn
    expect(rateLimitRetrySeconds("retry in 0.1s")).toBe(1);
  });

  // Real sleeps: the backoff ladder (1+2+4+8s) is the behavior under test.
  it("counts ONE 429 as ONE circuit failure; non-rate-limit errors never trip it", { timeout: 30_000 }, async () => {
    const four29 = (): StreamEvent[] => [
      { type: "error", message: "429 quota exceeded. Please retry in 1s." },
    ];
    const model404 = (): StreamEvent[] => [
      { type: "error", message: "models/nope-xyz is not found for API version v1beta" },
    ];

    // 5 rate-limited turns (each fails once, no retry consumed by the fake:
    // the first 429 in a turn retries → the retry also 429s... one turn = 2
    // provider calls, 2 failures). 3 turns × 2 = 6 failures ≥ threshold(5)
    // → circuit opens. A 404-based turn NEVER moves the breaker.
    const provider = new (FakeProvider as any)([
      four29(), four29(),
      four29(), four29(),
      four29(), four29(),
      model404(),
    ]);
    const session = new AgentSession(provider, {
      systemPrompt: "test",
      model: "fake-model",
      maxTokens: 1024,
      projectRoot: root,
      permissionBroker: { async requestPermission() { return true; } },
    });

    for (let i = 0; i < 3; i++) {
      for await (const e of session.send("hi")) {
        if (e.type === "error") break;
      }
    }
    expect(getCircuitState("anthropic", "fake-model")).toBe("open");

    // A fresh session on a closed circuit keeps it closed across repeated
    // 404s (different model id → different breaker key than the part above).
    const p404 = new (FakeProvider as any)([model404(), model404(), model404()]);
    const s404 = new AgentSession(p404, {
      systemPrompt: "test",
      model: "fake-model-404",
      maxTokens: 1024,
      projectRoot: root,
      permissionBroker: { async requestPermission() { return true; } },
    });
    for (let i = 0; i < 3; i++) {
      for await (const e of s404.send("hi")) {
        if (e.type === "error") break;
      }
    }
    expect(getCircuitState("anthropic", "fake-model-404")).toBe("closed");
  });
});
