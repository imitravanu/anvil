import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AgentSession, type AgentEvent } from "../index.js";
import { detectGuardianScope } from "../../guardian/scope.js";
import { FakeProvider } from "./fakeProvider.js";
import type { StreamEvent } from "../../providers/types.js";

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "anvil-guardian-toggle-"));
  // The toggle tests exercise Anvil-scoped families (raw-error auto-fix), so
  // the fixture root must BE the Anvil repo as far as the scope detector is
  // concerned — same fixture contract as guardianDispatch.test.ts.
  await fs.mkdir(path.join(root, "packages", "core"), { recursive: true });
  await fs.writeFile(
    path.join(root, "packages", "core", "package.json"),
    JSON.stringify({ name: "@anvil/core" })
  );
  expect(detectGuardianScope(root)).toBe("anvil");
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

// Fixture strings are assembled from split literals so THIS test file never
// contains the literal forbidden patterns — the gate Step 1 scans added lines
// of untracked test files too (the same trick scanner.ts itself uses).
const AS_ANY = "const x = input as an" + "y;";
const RAW_TERNARY = "err instanceof " + "Error ? err.message : String(" + "err)";

function slopTurn(): StreamEvent[] {
  return [
    { type: "tool_call_start", id: "slop-write", name: "write_file" },
    {
      type: "tool_call_end",
      id: "slop-write",
      name: "write_file",
      input: { path: "src/slop.ts", content: `${AS_ANY}\n${RAW_TERNARY}\n` },
    },
    { type: "turn_end", stopReason: "tool_use" },
  ];
}

function textTurn(text = "Done."): StreamEvent[] {
  return [{ type: "text_delta", text }, { type: "turn_end", stopReason: "end_turn" }];
}

function makeSession(script: StreamEvent[][], guardian?: boolean): AgentSession {
  return new AgentSession(new FakeProvider(script), {
    systemPrompt: "test",
    model: "fake-model",
    maxTokens: 1024,
    projectRoot: root,
    permissionBroker: { async requestPermission() { return true; } },
    ...(guardian === undefined ? {} : { guardian }),
  });
}

async function collect(gen: AsyncGenerator<AgentEvent>): Promise<AgentEvent[]> {
  const out: AgentEvent[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

describe("Guardian toggle (26.3)", () => {
  it("default stays ON: violations block and auto-fix applies", async () => {
    const session = makeSession([slopTurn(), textTurn("Fixed and retried.")]);
    const events = await collect(session.send("write the file"));

    // as-any is not auto-fixable → a blocked event with the violation.
    expect(events.some((e) => e.type === "guardian_blocked")).toBe(true);
    await expect(fs.readFile(path.join(root, "src/slop.ts"), "utf8")).rejects.toThrow();
  });

  it("guardian: false opts the session out — the call runs unguarded", async () => {
    const session = makeSession([slopTurn(), textTurn()], false);
    const events = await collect(session.send("write the file"));

    expect(events.some((e) => e.type === "guardian_blocked")).toBe(false);
    // The mutation was ALLOWED through — the file exists and the slop landed
    // byte-for-byte. This is the whole point of the flag: measure what the
    // model does when nothing is guarding it.
    const written = await fs.readFile(path.join(root, "src/slop.ts"), "utf8");
    expect(written).toContain(AS_ANY);
    expect(written).toContain(RAW_TERNARY);
  });

  it("guardian: false does not even auto-fix raw-error formatting", async () => {
    // Only the auto-fixable family: without the guardian, the text reaches
    // disk unrepaired (the ON path would rewrite it to getErrorMessage).
    const script: StreamEvent[] = [
      { type: "tool_call_start", id: "raw-write", name: "write_file" },
      {
        type: "tool_call_end",
        id: "raw-write",
        name: "write_file",
        input: { path: "src/raw.ts", content: `${RAW_TERNARY}\n` },
      },
      { type: "turn_end", stopReason: "tool_use" },
    ];
    const session = makeSession([script, textTurn()], false);
    const events = await collect(session.send("write the file"));

    expect(events.some((e) => e.type === "guardian_blocked")).toBe(false);
    const written = await fs.readFile(path.join(root, "src/raw.ts"), "utf8");
    expect(written).toContain(RAW_TERNARY);
    expect(written).not.toContain("getErrorMessage");
  });
});
