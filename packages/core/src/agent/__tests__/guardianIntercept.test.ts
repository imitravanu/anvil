import { describe, expect, it } from "vitest";
import { guardianInterceptCalls } from "../guardianIntercept.js";
import type { PreparedCall } from "../loopGuard.js";
import type { RunLedgerEntry } from "../ledger.js";
import type { ToolDefinition } from "../../tools/types.js";
import type { GuardianScope } from "../../guardian/scope.js";

// Fixture strings are assembled from split literals so THIS test file never
// contains the literal forbidden patterns — the gate scans added lines of
// untracked test files too (the same trick scanner.ts itself uses).
const AS_ANY = "const x = input as an" + "y;";
const RAW_ERR_A = "err instanceof " + "Error ? err.message : String(err)";
const RAW_ERR_E2 = "e2 instanceof " + "Error ? e2.message : String(e2)";

function prepared(
  name: string,
  input: unknown,
  opts: { id?: string; mutating?: boolean } = {}
): PreparedCall {
  const def: ToolDefinition = {
    name,
    description: "",
    inputSchema: { type: "object", properties: {} },
    mutating: opts.mutating ?? true,
  };
  return {
    call: { id: opts.id ?? name, name, input },
    def,
    key: `${name}:key`,
    refused: false,
    loopWarn: false,
    repeatWarn: false,
  };
}

function deps(scope: GuardianScope = "anvil", enabled = true) {
  const ledger: Omit<RunLedgerEntry, "seq" | "ts">[] = [];
  return {
    ledger,
    opts: {
      enabled,
      scope,
      rules: [],
      recordLedger: (entry: Omit<RunLedgerEntry, "seq" | "ts">) => ledger.push(entry),
    },
  };
}

describe("guardianInterceptCalls", () => {
  it("passes through untouched when disabled", () => {
    const call = prepared("write_file", { path: "src/a.ts", content: `${AS_ANY}\n` });
    const { ledger, opts } = deps("anvil", false);

    const result = guardianInterceptCalls([call], opts);

    expect(result.blocked.size).toBe(0);
    expect(result.event).toBeNull();
    expect(result.repairPrompt).toBeNull();
    expect(ledger).toHaveLength(0);
  });

  it("blocks a violating mutation, returns the refusal result, ledger entry and repair prompt", () => {
    const call = prepared("write_file", { path: "src/a.ts", content: `${AS_ANY}\n` });
    const { ledger, opts } = deps();

    const result = guardianInterceptCalls([call], opts);

    expect(result.blocked.has("write_file")).toBe(true);
    const handled = result.handled.get("write_file");
    expect(handled?.isError).toBe(true);
    expect(handled?.summary).toContain("write_file");
    expect(result.event?.type).toBe("guardian_blocked");
    expect(result.repairPrompt).toContain("blocked before execution");
    expect(ledger).toHaveLength(1);
    expect(ledger[0].eventType).toBe("loop_refused");
  });

  it("ignores non-mutating calls and mutating calls without a path", () => {
    const read = prepared("read_file", { path: "src/a.ts", content: `${AS_ANY}` }, { mutating: false });
    const noPath = prepared("write_file", { content: `${AS_ANY}` });
    const { opts } = deps();

    const result = guardianInterceptCalls([read, noPath], opts);

    expect(result.blocked.size).toBe(0);
    expect(result.event).toBeNull();
  });

  it("scans an external tool through its known file-body fields", () => {
    const call = prepared("mcp_probe__write_file", {
      path: "src/via-mcp.ts",
      content: `${AS_ANY}\n`,
    });
    const { opts } = deps();

    const result = guardianInterceptCalls([call], opts);

    expect(result.blocked.has("mcp_probe__write_file")).toBe(true);
  });

  it("applies an auto-fix to each call's OWN input by position (same path, two edits)", () => {
    const first = prepared(
      "edit_file",
      { path: "src/a.ts", old_str: "a", new_str: `one = ${RAW_ERR_A};` },
      { id: "e0" }
    );
    const second = prepared(
      "edit_file",
      { path: "src/a.ts", old_str: "c", new_str: `two = ${RAW_ERR_E2};` },
      { id: "e1" }
    );
    const { opts } = deps();

    const result = guardianInterceptCalls([first, second], opts);

    // Auto-fix is not a block.
    expect(result.blocked.size).toBe(0);
    expect(result.event).toBeNull();
    // Each input carries its OWN repaired text — a path-keyed repair would
    // feed the second edit's fixed text to the first call's input.
    expect((first.call.input as { new_str: string }).new_str).toContain("one = getErrorMessage(err);");
    expect((second.call.input as { new_str: string }).new_str).toContain("two = getErrorMessage(e2);");
  });

  it("universal families fire in foreign scope, anvil-only families do not", () => {
    // as-any is a universal family: it blocks anywhere.
    const universal = prepared("write_file", { path: "src/u.ts", content: `${AS_ANY}\n` });
    const universalResult = guardianInterceptCalls([universal], deps("foreign").opts);
    expect(universalResult.blocked.size).toBe(1);

    // raw-error is anvil-only: silent in a foreign project (it rewrites to an
    // @anvil/core helper that does not exist there).
    const anvilOnly = prepared("write_file", { path: "src/r.ts", content: `${RAW_ERR_A}\n` });
    const foreignResult = guardianInterceptCalls([anvilOnly], deps("foreign").opts);
    expect(foreignResult.blocked.size).toBe(0);
  });
});
