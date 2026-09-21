import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AgentSession, type AgentEvent } from "../index.js";
import { detectGuardianScope } from "../../guardian/scope.js";
import { FakeProvider } from "./fakeProvider.js";
import type { StreamEvent } from "../../providers/types.js";
import { registerExternalExecutor } from "../../tools/index.js";
import type { ToolDefinition } from "../../tools/types.js";

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "anvil-guardian-dispatch-"));
  // These dispatch tests exercise the Anvil-scoped families (raw-error
  // auto-fix rewrites to getErrorMessage, an @anvil/core helper), so the
  // fixture root must BE the Anvil repo as far as the scope detector is
  // concerned: packages/core declaring @anvil/core. A bare temp dir now
  // classifies as "foreign", where that family correctly never fires.
  await fs.mkdir(path.join(root, "packages", "core"), { recursive: true });
  await fs.writeFile(
    path.join(root, "packages", "core", "package.json"),
    JSON.stringify({ name: "@anvil/core" })
  );
  // Assert the classification BEFORE any session runs: if the detector's
  // sentinel contract ever changes, these tests fail here with the real
  // cause instead of as confusing auto-fix misses.
  expect(detectGuardianScope(root)).toBe("anvil");
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

// Fixture strings are assembled from split literals so THIS test file never
// contains the literal forbidden patterns — the gate Step 1 scans added lines
// of untracked test files too (the same trick scanner.ts itself uses).
const RAW_TERNARY = "err instanceof " + "Error ? err.message : String(" + "err)";
// Two DIFFERENT raw-error patterns (distinct error identifiers) so a repair
// cross-contamination between same-path calls is observable in written bytes.
const RAW_ERR_A = "err instanceof " + "Error ? err.message : String(err)";
const RAW_ERR_E2 = "e2 instanceof " + "Error ? e2.message : String(e2)";
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

function makeSession(script: StreamEvent[][], tools?: ToolDefinition[]): AgentSession {
  return new AgentSession(new FakeProvider(script), {
    systemPrompt: "test",
    model: "fake-model",
    maxTokens: 1024,
    projectRoot: root,
    permissionBroker: { async requestPermission() { return true; } },
    ...(tools ? { tools } : {}),
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

  it("reports the number of blocked CALLS, not distinct paths", async () => {
    // Two refused writes to the SAME file: the violation list is keyed by
    // path, so a path-keyed count reported 1. The event contract (and the
    // headless line `guardian_blocked count=N`) means refused calls.
    const session = makeSession([
      [
        { type: "tool_call_start", id: "b0", name: "write_file" },
        {
          type: "tool_call_end",
          id: "b0",
          name: "write_file",
          input: { path: "src/slop.ts", content: `${AS_ANY}\n// first\n` },
        },
        { type: "tool_call_start", id: "b1", name: "write_file" },
        {
          type: "tool_call_end",
          id: "b1",
          name: "write_file",
          input: { path: "src/slop.ts", content: `${AS_ANY}\n// second\n` },
        },
        { type: "turn_end", stopReason: "tool_use" },
      ],
      textTurn("Fixing."),
    ]);

    const events = await collect(session.send("write the file twice"));
    const blocked = events.find((e) => e.type === "guardian_blocked");
    if (blocked?.type !== "guardian_blocked") throw new Error("expected guardian_blocked");
    expect(blocked.count).toBe(2);
    await expect(fs.access(path.join(root, "src/slop.ts"))).rejects.toThrow();
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

  it("enforces a project's guardian:rules block loaded from AGENTS.md", async () => {
    await fs.mkdir(path.join(root, "src"), { recursive: true });
    await fs.writeFile(
      path.join(root, "AGENTS.md"),
      [
        "# Project rules",
        "<!-- guardian:rules",
        'no-moment: /from ["\']moment["\']/ : "Use date-fns instead"',
        "-->",
      ].join("\n")
    );
    const session = makeSession([
      [
        { type: "tool_call_start", id: "m0", name: "write_file" },
        {
          type: "tool_call_end",
          id: "m0",
          name: "write_file",
          input: { path: "src/time.ts", content: 'import moment from "moment";\n' },
        },
        { type: "turn_end", stopReason: "tool_use" },
      ],
      textTurn("ok"),
    ]);

    const events = await collect(session.send("add a date helper"));
    const blocked = events.find((e) => e.type === "guardian_blocked");
    expect(blocked).toBeDefined();
    await expect(fs.access(path.join(root, "src/time.ts"))).rejects.toThrow();
  });

  it("auto-fixes two edits to the SAME path independently in one batch", async () => {
    const target = path.join(root, "src/fixed.ts");
    await fs.mkdir(path.join(root, "src"), { recursive: true });
    await fs.writeFile(target, "const a = 1;\nconst b = 2;\nconst c = 3;\n");
    // Two edits, same file, one batch, different lines — each with a DIFFERENT
    // raw-error pattern, so a path-keyed repair mix-up is observable in bytes.
    const session = makeSession([
      [
        { type: "tool_call_start", id: "e0", name: "edit_file" },
        {
          type: "tool_call_end",
          id: "e0",
          name: "edit_file",
          input: { path: "src/fixed.ts", old_str: "const a = 1;", new_str: `const one = ${RAW_ERR_A};` },
        },
        { type: "tool_call_start", id: "e1", name: "edit_file" },
        {
          type: "tool_call_end",
          id: "e1",
          name: "edit_file",
          input: { path: "src/fixed.ts", old_str: "const c = 3;", new_str: `const two = ${RAW_ERR_E2};` },
        },
        { type: "turn_end", stopReason: "tool_use" },
      ],
      textTurn(),
    ]);

    const events = await collect(session.send("edit the same file twice"));

    // Both edits auto-fixed and executed — no block.
    expect(events.some((e) => e.type === "guardian_blocked")).toBe(false);
    const started = events.filter((e) => e.type === "tool_started");
    expect(started.map((e) => ("name" in e ? e.name : ""))).toEqual(["edit_file", "edit_file"]);

    const written = await fs.readFile(target, "utf8");
    // The first edit carried ITS OWN repaired text…
    expect(written).toContain("const one = getErrorMessage(err);");
    // …NOT the second edit's repaired text (the old path-keyed bug fed B's
    // repair to A's input because both shared the path).
    expect(written).not.toContain("const one = getErrorMessage(e2)");
    // The second edit carried ITS OWN repaired text.
    expect(written).toContain("const two = getErrorMessage(e2);");
    // Untouched line survived both edits.
    expect(written).toContain("const b = 2;");
  });
});

// Regression: the interceptor used to scan a mutating external tool's
// permission-prompt preview, which carries no `+` lines — so the diff scanner
// could never match, and an MCP/plugin file write passed through unscanned
// while the guardian claimed to be intercepting it.
describe("Guardian scan surface for external tools", () => {
  function externalWriteDef(prefix: string, onRun: () => void): ToolDefinition {
    registerExternalExecutor(prefix, async () => {
      onRun();
      return {
        claimed: true,
        result: { output: { ok: true }, isError: false, summary: "probe write finished." },
      };
    });
    return {
      name: `${prefix}write_file`,
      description: "probe write tool",
      inputSchema: { type: "object", properties: {} },
      mutating: true,
    };
  }

  function turnFor(def: ToolDefinition, id: string, input: unknown): StreamEvent[] {
    return [
      { type: "tool_call_start", id, name: def.name },
      { type: "tool_call_end", id, name: def.name, input },
      { type: "turn_end", stopReason: "tool_use" },
    ];
  }

  it("blocks a mutating MCP-style tool whose file body carries a violation", async () => {
    let executed = false;
    const def = externalWriteDef("mcp_guardprobe__", () => {
      executed = true;
    });
    const session = makeSession(
      [
        turnFor(def, "m0", { path: "src/via-mcp.ts", content: `${AS_ANY}\n` }),
        textTurn("Fixing the violation."),
      ],
      [def]
    );

    const events = await collect(session.send("write a helper"));

    expect(events.some((e) => e.type === "guardian_blocked")).toBe(true);
    expect(events.some((e) => e.type === "tool_started")).toBe(false);
    // The refusal is execution-faithful: the external executor never ran.
    expect(executed).toBe(false);
  });

  it("lets the same tool through when its file body is clean", async () => {
    let executed = false;
    const def = externalWriteDef("mcp_guardclean__", () => {
      executed = true;
    });
    const session = makeSession(
      [
        turnFor(def, "c0", { path: "src/clean.ts", content: "export const ok = 1;\n" }),
        textTurn(),
      ],
      [def]
    );

    const events = await collect(session.send("write a helper"));

    expect(events.some((e) => e.type === "guardian_blocked")).toBe(false);
    expect(executed).toBe(true);
  });
});
