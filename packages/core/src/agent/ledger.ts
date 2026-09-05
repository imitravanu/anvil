// append-only run ledger that records what the loop actually did.
// Capped so session files stay growth-bounded. The entry shape is serial:
// {seq, ts, eventType, tool?, inputHash?, outcome, tokens?, elapsedMs}.

export const LEDGER_CAP = 1000;

export type LedgerOutcome = "ok" | "error" | "denied" | "aborted";

export interface RunLedgerEntry {
  seq: number;
  ts: string;
  eventType: string;
  tool?: string;
  inputHash?: string;
  outcome: LedgerOutcome;
  tokens?: { in: number; out: number };
  elapsedMs: number;
}

/** Drop the OLDEST entries beyond the cap (the most recent history is kept). */
export function capLedger(entries: readonly RunLedgerEntry[]): RunLedgerEntry[] {
  if (entries.length <= LEDGER_CAP) return [...entries];
  return entries.slice(entries.length - LEDGER_CAP);
}

export function maxSeq(entries: readonly RunLedgerEntry[]): number {
  return entries.reduce((m, e) => (e.seq > m ? e.seq : m), 0);
}