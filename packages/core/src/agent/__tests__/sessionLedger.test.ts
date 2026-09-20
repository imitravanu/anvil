import { describe, expect, it } from "vitest";
import { SessionLedger } from "../sessionLedger.js";
import { LEDGER_CAP } from "../ledger.js";

describe("SessionLedger", () => {
  it("attaches measured usage only to completion entries", () => {
    const ledger = new SessionLedger();
    const usage = { inputTokens: 10, outputTokens: 4 };
    ledger.record({ eventType: "verification_started", outcome: "ok", elapsedMs: 0 }, usage);
    ledger.record({ eventType: "tool_finished", tool: "read_file", outcome: "ok", elapsedMs: 1 }, usage);
    const [control, completion] = ledger.snapshot();
    // Control events must not fabricate token attribution.
    expect(control.tokens).toBeUndefined();
    expect(completion.tokens).toEqual({ in: 10, out: 4 });
  });

  it("lets explicit tokens win over measured usage", () => {
    const ledger = new SessionLedger();
    ledger.record(
      { eventType: "tool_finished", outcome: "ok", elapsedMs: 0, tokens: { in: 1, out: 2 } },
      { inputTokens: 9, outputTokens: 9 }
    );
    expect(ledger.snapshot()[0].tokens).toEqual({ in: 1, out: 2 });
  });

  it("records no tokens when none were measured", () => {
    const ledger = new SessionLedger();
    ledger.record({ eventType: "tool_finished", outcome: "ok", elapsedMs: 0 }, null);
    expect(ledger.snapshot()[0].tokens).toBeUndefined();
  });

  it("caps the ring and keeps the sequence monotonic across a resume", () => {
    const ledger = new SessionLedger();
    for (let i = 0; i < LEDGER_CAP + 5; i++) {
      ledger.record({ eventType: "tool_finished", outcome: "ok", elapsedMs: 0 }, null);
    }
    expect(ledger.size).toBe(LEDGER_CAP);
    const resumed = new SessionLedger(ledger.toPersist());
    resumed.record({ eventType: "tool_finished", outcome: "ok", elapsedMs: 0 }, null);
    expect(resumed.snapshot().at(-1)?.seq).toBeGreaterThan(LEDGER_CAP + 4);
  });
});
