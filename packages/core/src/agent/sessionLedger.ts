import { capLedger, maxSeq, LEDGER_CAP, type RunLedgerEntry } from "./ledger.js";

/** Measured usage to attribute to a completion entry. */
export interface LedgerUsage {
  inputTokens: number;
  outputTokens: number;
}

/**
 * The session's append-only run ledger: the capped entry list, the monotonic
 * sequence, and the one attribution rule — measured usage rides only on
 * completion entries (record, never predict), unless the caller passes explicit
 * tokens (e.g. a sub-agent's own usage). Extracted from `AgentSession` so the
 * ledger's semantics are testable without a session, and so `send()` reads a
 * seam instead of an array.
 */
export class SessionLedger {
  private entries: RunLedgerEntry[];
  private seq: number;

  constructor(restored: readonly RunLedgerEntry[] = []) {
    this.entries = capLedger(restored);
    this.seq = maxSeq(this.entries);
  }

  /** Entry count — the "does anything need persisting" check. */
  get size(): number {
    return this.entries.length;
  }

  record(entry: Omit<RunLedgerEntry, "seq" | "ts">, usage: LedgerUsage | null): void {
    this.seq += 1;
    this.entries.push({
      ...entry,
      // Explicit tokens always win; otherwise only a tool_finished entry may
      // inherit the last measured usage. Control events (loop_detected,
      // budget_exhausted, cancelled, checkpoint_created, …) must not fabricate
      // token attribution.
      ...(entry.tokens ??
        (entry.eventType === "tool_finished" && usage
          ? { tokens: { in: usage.inputTokens, out: usage.outputTokens } }
          : {})),
      seq: this.seq,
      ts: new Date().toISOString(),
    });
    if (this.entries.length > LEDGER_CAP) {
      this.entries = capLedger(this.entries);
    }
  }

  /** Read-only copy for the UI (`/ledger`). */
  snapshot(): RunLedgerEntry[] {
    return [...this.entries];
  }

  /** Capped copy for persistence. */
  toPersist(): RunLedgerEntry[] {
    return capLedger(this.entries);
  }
}
