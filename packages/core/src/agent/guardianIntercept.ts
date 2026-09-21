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

/** Concatenate the recognized file-body fields of an external tool's input. */
function externalToolBody(input: unknown): string {
  if (input === null || typeof input !== "object" || Array.isArray(input)) return "";
  const record = input as Record<string, unknown>;
  const parts: string[] = [];
  for (const key of GUARDIAN_CONTENT_KEYS) {
    const value = record[key];
    if (typeof value === "string" && value.length > 0) parts.push(value);
  }
  return parts.join("\n");
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
  const pending: { call: PreparedCall; path: string; diff: string }[] = [];
  for (const p of prepared) {
    if (!p.def?.mutating) continue;
    const input = (p.call.input ?? {}) as { path?: unknown; content?: unknown; new_str?: unknown };
    const relPath = typeof input.path === "string" ? input.path : undefined;
    if (!relPath) continue;
    // write_file/edit_file declare their body explicitly; external (MCP /
    // plugin) tools are scanned through their known file-body fields, because
    // their input is not a diff and the permission-prompt preview is prose
    // with no `+` lines — scanning that could never match anything.
    let body: string;
    if (fileWriteTools.has(p.def.name)) {
      body =
        typeof input.content === "string"
          ? input.content
          : typeof input.new_str === "string"
            ? input.new_str
            : "";
    } else {
      body = externalToolBody(p.call.input);
    }
    if (body.length === 0) continue;
    pending.push({ call: p, path: relPath, diff: asAddedLines(body) });
  }

  if (pending.length === 0) return { blocked, handled, event: null, repairPrompt: null };
  const intercept = interceptTurn(
    pending.map((p) => ({ path: p.path, diff: p.diff })),
    deps.scope,
    deps.rules
  );
  if (intercept.fixed.length > 0) {
    // Auto-fix: raw-error ternary → getErrorMessage, applied back to each
    // call's OWN input BY POSITION (fix.index). A path-keyed map is wrong
    // when one turn carries two pending edits to the same file: the second
    // edit would reuse the first's repaired text.
    for (const fix of intercept.fixed) {
      const p = pending[fix.index];
      if (!p) continue;
      const fixedText = guardianFixedText(fix.diff);
      const input = (p.call.call.input ?? {}) as { content?: string; new_str?: string };
      if (typeof input.content === "string") input.content = fixedText;
      else if (typeof input.new_str === "string") input.new_str = fixedText;
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
