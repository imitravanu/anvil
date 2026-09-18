import { describe, expect, it } from "vitest";
import { scoreMessages, contextBreakdown, selectiveKeep } from "../scoring.js";
import type { ConversationMessage } from "../../../providers/types.js";

function user(text: string): ConversationMessage {
  return { role: "user", content: [{ type: "text", text }] };
}

function assistant(text: string): ConversationMessage {
  return { role: "assistant", content: [{ type: "text", text }] };
}

describe("scoreMessages", () => {
  it("ranks task-relevant messages higher", () => {
    const messages = [
      user("what is the weather today"),
      user("fix the authentication login bug in auth.ts"),
    ];
    const scored = scoreMessages(messages, "fix authentication login", ["auth.ts"]);
    expect(scored[1].score).toBeGreaterThan(scored[0].score);
  });

  it("scores recent messages higher on ties", () => {
    const messages = [user("hello world"), user("hello world")];
    const scored = scoreMessages(messages, "unrelated task xyz");
    expect(scored[1].score).toBeGreaterThanOrEqual(scored[0].score);
  });
});

describe("contextBreakdown", () => {
  it("splits tokens by role and warns past threshold", () => {
    const messages = [user("a".repeat(400)), assistant("b".repeat(400))];
    const full = contextBreakdown(messages, 100, 0.6);
    expect(full.totalTokens).toBe(200);
    expect(full.byRole.user).toBe(100);
    expect(full.byRole.assistant).toBe(100);
    expect(full.shouldWarn).toBe(true);
    const calm = contextBreakdown(messages, 10_000, 0.6);
    expect(calm.shouldWarn).toBe(false);
  });
});

describe("selectiveKeep", () => {
  it("always keeps the latest message", () => {
    const messages = [user("old topic alpha"), user("old topic beta"), user("latest")];
    const kept = selectiveKeep(messages, "something else entirely", 10);
    expect(kept).toContain(2);
  });

  it("keeps relevant messages within budget", () => {
    const messages = [
      user("authentication login flow"),
      user("unrelated gardening tips"),
      user("authentication session refresh"),
    ];
    const kept = selectiveKeep(messages, "authentication login", 10_000);
    expect(kept).toContain(0);
    expect(kept).toContain(2);
  });
});
