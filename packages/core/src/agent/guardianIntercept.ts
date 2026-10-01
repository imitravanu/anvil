import { interceptTurn, guardianFixedText } from "../guardian/interceptor.js";
import type { CustomGuardianRule } from "../guardian/rules.js";
import type { GuardianScope } from "../guardian/scope.js";
import type { ToolExecutionResult } from "../tools/types.js";
import type { RunLedgerEntry } from "./ledger.js";
import type { PreparedCall } from "./loopGuard.js";
import type { AgentEvent } from "./types.js";

/**
 * File-body keys a mutating external (MCP / plugin) tool is expected to carry
 * its NEW content under. Only these are inspected: scanning the whole input
 * payload would flag legitimate arguments (a query for a placeholder marker is
 * not slop). A tool that names its body something else is not scanned — the
 * coverage note on `guardianInterceptCalls` states that limit.
 */
const GUARDIAN_CONTENT_KEYS = ["content", "new_str", "new_content", "text", "body", "data"];

/** A scannable body and the writer that puts a repair back in the SAME field. */
interface WritableBody {
  body: string;
  writeBack: (text: string) => void;
}

/**
 * C5 (AUDIT-2026-09-30): return the body AND a writer for the field it came
 * from, so an auto-fix lands where the body lived. A body assembled from
 * several keys has no single writer — returning null leaves the call unscanned
 * rather than reporting it "fixed" while the original slop still executes.
 */
function singleBodyField(input: unknown): WritableBody | null {
  if (input === null || typeof input !== "object" || Array.isArray(input)) return null;
  const record = input as Record<string, unknown>;
  const present = GUARDIAN_CONTENT_KEYS.filter(
    (key) => typeof record[key] === "string" && (record[key] as string).length > 0
  );
  if (present.length !== 1) return null;
  const key = present[0];
  return {
    body: record[key] as string,
    writeBack: (text: string) => {
      record[key] = text;
    },
  };
}

/** Literal text rendered as the added-line form the diff scanner expects. */
function asAddedLines(text: string): string {
  return text.split("\n").map((line) => `+${line}`).join("\n");
}

export interface GuardianInterceptDeps {
  /** Master switch (26.3). False short-circuits: no scan, no block, no auto-fix. */
  enabled: boolean;
  scope: GuardianScope;
  rules: readonly CustomGuardianRule[];
  recordLedger: (entry: Omit<RunLedgerEntry, "seq" | "ts">) => void;
}

export interface GuardianInterceptResult {
  /** Ids of calls that must NOT execute (their results ride back in `handled`). */
  blocked: Set<string>;
  /** Refusal results keyed by call id, for the outcome map. */
  handled: Map<string, ToolExecutionResult>;
  /** Turn-report event, or null when nothing was blocked. */
  event: AgentEvent | null;
  /**
   * Repair prompt for the model, or null. Returned rather than pushed so the
   * caller (which owns history) decides how to record it.
   */
  repairPrompt: string | null;
}

/**
 * Phase 25.6 native guardian gate — the agent-layer glue around the guardian's
 * pure scanner. Refuses (or auto-fixes) pending file mutations BEFORE they
 * reach the orchestrator.
 *
 * Side effect, by design: an auto-fixed body is written back into the offending
 * call's OWN `input` (see the positional note below), because that input is the
 * pending mutation the orchestrator will execute.
 *
 * Coverage, stated precisely: a call is scanned when it is mutating AND its
 * input carries a `path` string. `write_file` / `edit_file` bodies are scanned
 * literally; every other tool (MCP, plugins) is scanned through its known
 * file-body fields. `run_command` is NOT scanned — it declares no `path`, and
 * scanning raw command text would refuse legitimate commands (a grep for a
 * placeholder marker is not slop). Shell mutations are gated by the permission
 * prompt and the destructive-command refusal instead.
 */
export function guardianInterceptCalls(
  prepared: readonly PreparedCall[],
  deps: GuardianInterceptDeps
): GuardianInterceptResult {
  const blocked = new Set<string>();
  const handled = new Map<string, ToolExecutionResult>();
  if (!deps.enabled) return { blocked, handled, event: null, repairPrompt: null };
  const fileWriteTools = new Set(["write_file", "edit_file"]);
  const pending: {
    call: PreparedCall;
    path: string;
    diff: string;
    writeBack: (text: string) => void;
  }[] = [];
  for (const p of prepared) {
    if (!p.def?.mutating) continue;
    const input = (p.call.input ?? {}) as { path?: unknown };
    const relPath = typeof input.path === "string" ? input.path : undefined;
    if (!relPath) continue;
    // write_file/edit_file declare their body explicitly; external (MCP /
    // plugin) tools are scanned through a SINGLE recognized file-body field,
    // because their input is not a diff and the permission-prompt preview is
    // prose with no `+` lines — scanning that could never match anything.
    let writable: WritableBody | null = null;
    if (fileWriteTools.has(p.def.name)) {
      const record = p.call.input as { content?: unknown; new_str?: unknown } | null;
      if (typeof record?.content === "string") {
        writable = { body: record.content, writeBack: (t) => { (record as { content?: string }).content = t; } };
      } else if (typeof record?.new_str === "string") {
        writable = { body: record.new_str, writeBack: (t) => { (record as { new_str?: string }).new_str = t; } };
      }
    } else {
      writable = singleBodyField(p.call.input);
    }
    if (!writable || writable.body.length === 0) continue;
    pending.push({ call: p, path: relPath, diff: asAddedLines(writable.body), writeBack: writable.writeBack });
  }

  if (pending.length === 0) return { blocked, handled, event: null, repairPrompt: null };
  const intercept = interceptTurn(
    pending.map((p) => ({ path: p.path, diff: p.diff })),
    deps.scope,
    deps.rules
  );
  if (intercept.fixed.length > 0) {
    // Auto-fix: raw-error ternary → getErrorMessage, applied back through the
    // writer for the field the body came from, BY POSITION (fix.index). A
    // path-keyed map is wrong when one turn carries two pending edits to the
    // same file: the second edit would reuse the first's repaired text.
    for (const fix of intercept.fixed) {
      const p = pending[fix.index];
      if (!p) continue;
      p.writeBack(guardianFixedText(fix.diff));
    }
  }
  if (intercept.allowed) return { blocked, handled, event: null, repairPrompt: null };

  const blockedByPath = new Set(intercept.violations.map((v) => v.file));
  for (const { call, path } of pending) {
    if (!blockedByPath.has(path)) continue;
    const callViolations = intercept.violations.filter((v) => v.file === path);
    blocked.add(call.call.id);
    handled.set(call.call.id, {
      output: {
        error:
          `Guardian blocked this call — pending changes to ${path} violate the project's hygiene rules: ` +
          callViolations
            .map((v) => `${v.rule} (line ${v.line}): ${v.detail}`)
            .join("; ") +
          ". Fix the violations and retry — do NOT re-emit the call unchanged.",
      },
      isError: true,
      summary: `Guardian blocked ${call.def?.name ?? "tool"} on ${path}`,
    });
    deps.recordLedger({
      eventType: "loop_refused",
      tool: call.def?.name ?? "tool",
      inputHash: call.key,
      outcome: "error",
      elapsedMs: 0,
    });
  }
  const repairPrompt =
    `[Guardian] Your pending file mutation${intercept.violations.length === 1 ? " was" : "s were"} blocked before execution. ` +
    `Violations:\n` +
    intercept.violations.map((v) => `- ${v.file}: line ${v.line} — ${v.rule}: ${v.detail}`).join("\n") +
    `\nFix these issues (use getErrorMessage(err) for error formatting; never catch-and-ignore) and retry.`;
  return {
    blocked,
    handled,
    repairPrompt,
    event: {
      type: "guardian_blocked",
      // CALLS refused, not distinct paths: the event contract and both
      // renderers say "N pending call(s) blocked". Two refused writes to
      // one file must report 2, not 1.
      count: blocked.size,
      fixed: intercept.fixed.length,
      firstRule: intercept.violations[0]?.rule ?? "unknown",
      violations: intercept.violations,
      fixes: intercept.fixed,
    },
  };
}
