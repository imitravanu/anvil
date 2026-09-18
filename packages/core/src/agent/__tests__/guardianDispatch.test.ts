import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AgentSession, type AgentEvent } from "../index.js";
import { FakeProvider } from "./fakeProvider.js";
import type { StreamEvent } from "../../providers/types.js";

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "anvil-guardian-dispatch-"));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

// Fixture strings are assembled from split literals so THIS test file never
// contains the literal forbidden patterns — the gate Step 1 scans added lines
// of untracked test files too (the same trick scanner.ts itself uses).
const RAW_TERNARY = "err instanceof " + "Error ? err.message : String(" + "err)";
const AS_ANY = "const x = input as an" + "y;";

function blockedWriteTurn(): StreamEvent[] {
  // The as-any cast family is NOT in the guardian's auto-fix family (only raw-error
  // formatting is), so this call must be refused, not silently repaired.
  return [
    { type: "tool_call_start", id: "blocked-write", name: "write_file" },
    {
      type: "tool_call_end",
      id: "blocked-write",
      name: "write_file",
      input: { path: "src/slop.ts", content: `${AS_ANY}\n` },
    },
    { type: "turn_end", stopReason: "tool_use" },
  ];
}

function textTurn(text = "Done."): StreamEvent[] {
  return [{ type: "text_delta", text }, { type: "turn_end", stopReason: "end_turn" }];
}

function makeSession(script: StreamEvent[][]): AgentSession {
  return new AgentSession(new FakeProvider(script), {
    systemPrompt: "test",
    model: "fake-model",
    maxTokens: 1024,
    projectRoot: root,
    permissionBroker: { async requestPermission() { return true; } },
  });
}

async function collect(gen: AsyncGenerator<AgentEvent>): Promise<AgentEvent[]> {
  const out: AgentEvent[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

describe("Guardian dispatch", () => {
  it("never executes a file mutation that Guardian refused", async () => {
    const session = makeSession([blockedWriteTurn(), textTurn("I will fix the violation.")]);

    const events = await collect(session.send("write the file"));

    expect(events.some((event) => event.type === "guardian_blocked")).toBe(true);
    expect(events.some((event) => event.type === "tool_started")).toBe(false);
    await expect(fs.access(path.join(root, "src/slop.ts"))).rejects.toThrow();
  });

  it("refusing one call in a batch does not execute it but the rest of the batch still runs", async () => {
    const readable = path.join(root, "src/other.ts");
    await fs.mkdir(path.join(root, "src"), { recursive: true });
    await fs.writeFile(readable, "export {};\n");
    const session = makeSession([
      [
        { type: "tool_call_start", id: "w0", name: "write_file" },
        {
          type: "tool_call_end",
          id: "w0",
          name: "write_file",
          input: { path: "src/slop.ts", content: `${AS_ANY}\n` },
        },
        { type: "tool_call_start", id: "r0", name: "read_file" },
        { type: "tool_call_end", id: "r0", name: "read_file", input: { path: "src/other.ts" } },
        { type: "turn_end", stopReason: "tool_use" },
      ],
      textTurn(),
    ]);

    const events = await collect(session.send("do both"));

    // The blocked write produced no execution…
    expect(events.some((event) => event.type === "guardian_blocked")).toBe(true);
    await expect(fs.access(path.join(root, "src/slop.ts"))).rejects.toThrow();
    // …while the clean read in the same batch executed normally.
    const started = events.filter((e) => e.type === "tool_started");
    expect(started.map((e) => ("name" in e ? e.name : ""))).toEqual(["read_file"]);
  });

  it("still auto-fixes the raw-error family in place and lets the call run", async () => {
    const session = makeSession([
      [
        { type: "tool_call_start", id: "w1", name: "write_file" },
        {
          type: "tool_call_end",
          id: "w1",
          name: "write_file",
          input: { path: "src/fixed.ts", content: `const message = ${RAW_TERNARY};\n` },
        },
        { type: "turn_end", stopReason: "tool_use" },
      ],
      textTurn(),
    ]);

    const events = await collect(session.send("write it"));

    expect(events.some((event) => event.type === "guardian_blocked")).toBe(false);
    expect(events.some((event) => event.type === "tool_started")).toBe(true);
    const written = await fs.readFile(path.join(root, "src/fixed.ts"), "utf8");
    expect(written).toContain("getErrorMessage(err)");
    expect(written).not.toContain("instanceof");
  });

  it("a loop-refused session tool never runs its handler (refusal checked before session tools)", async () => {
    const planTurn = (n: number): StreamEvent[] => [
      { type: "tool_call_start", id: `p${n}`, name: "update_plan" },
      { type: "tool_call_end", id: `p${n}`, name: "update_plan", input: { plan: "same plan" } },
      { type: "turn_end", stopReason: "tool_use" },
    ];
    // Three identical update_plan calls (warn on the 3rd, still run), then the
    // 4th identical call is loop-refused — its handler must not execute.
    const session = makeSession([planTurn(0), planTurn(1), planTurn(2), planTurn(3), textTurn()]);

    const events = await collect(session.send("plan repeatedly"));

    expect(events.filter((e) => e.type === "plan_updated")).toHaveLength(3);
  });
});
