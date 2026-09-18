/**
 * Per-turn mutable loop state for AgentSession.send(). Fresh instance per
 * send() call — budget and loop-guard state must never leak across turns
 * (a reused instance would instantly budget_exhaust the next turn).
 */
export class TurnState {
  iterationsUsed = 0;
  delegationsUsed = 0;
  lastToolKey: string | null = null;
  toolStreak = 0;
  loopNotified = false;
  /** Total per-key call counts this turn (non-consecutive repeat guard). */
  readonly totalCounts = new Map<string, number>();
  /** Compaction runs at most once per turn (history thrash guard). */
  compactedThisTurn = false;
  /** One automatic rate-limit retry per turn — a second 429 surfaces. */
  rateLimitRetried = false;
  /** Tracks whether file mutations occurred during this turn. */
  mutationsOccurred = false;
  /** Closed-loop verification self-repair attempts consumed this turn. */
  verifyRepairsUsed = 0;

    constructor(readonly maxInnerIterations: number) {}
  /**
   * The user prompt for this turn — used by the intelligent compaction path
   * (Phase 25.5) to keep high-relevance older messages verbatim before
   * summarizing the rest. Set once, on send().
   */
  task: string = "";

  /** Budget predicate for the loop-top check. */
  checkBudget(): boolean {
    return this.iterationsUsed >= this.maxInnerIterations;
  }

  markIteration(): void {
    this.iterationsUsed += 1;
  }

  markCompactionAttempted(): void {
    this.compactedThisTurn = true;
  }

  /**
   * Consume one delegation slot. Returns false when the per-turn limit is
   * already hit (caller emits the limit error). The increment happens BEFORE
   * the sub-agent runs so concurrent awaits can't all pass the check — and
   * refused paths must `continue` before calling this (no quota without work).
   */
  tryConsumeDelegation(limit: number): boolean {
    if (this.delegationsUsed >= limit) return false;
    this.delegationsUsed += 1;
    return true;
  }

  /**
   * Advance the consecutive streak + total counts for one tool key, in
   * declared call order. Returns the warn/refuse verdicts for this call.
   */
  observeKey(key: string): { loopWarn: boolean; repeatWarn: boolean; refused: boolean } {
    if (key === this.lastToolKey) this.toolStreak += 1;
    else {
      this.toolStreak = 1;
      this.lastToolKey = key;
    }
    const loopWarn = this.toolStreak === 3 && !this.loopNotified;
    if (loopWarn) this.loopNotified = true;
    // Non-consecutive repeat (A-B-A-B-A ping-pong the streak guard cannot
    // see): 3rd TOTAL occurrence with other calls in between. Warn once per
    // turn, never refuse — interleaved repeats are often legitimate re-reads.
    const total = (this.totalCounts.get(key) ?? 0) + 1;
    this.totalCounts.set(key, total);
    const repeatWarn = total === 3 && !loopWarn && this.toolStreak < 3 && !this.loopNotified;
    if (repeatWarn) this.loopNotified = true;
    return { loopWarn, repeatWarn, refused: this.toolStreak >= 4 };
  }
}
