import { describe, expect, it } from "vitest";
import { classifyTrialFailure } from "../experiment.js";

/**
 * PHASE 38.4 — HARNESS HONESTY
 *
 * The A/B harness exists to produce evidence about prompts, so the failure mode
 * that matters most is a harness that flatters itself. These assert the specific
 * ways that happens, each derived from something observed on a real run rather
 * than imagined.
 *
 * The live inception/mercury-2.5 run that opened 38.4 is the source: it
 * returned 120s timeouts on three of ten trials, and a timeout is a TIMEOUT, not
 * a statement about a prompt. Had those been graded as task failures the
 * candidate arm would have looked 40 points worse for reasons no prompt causes.
 */

describe("a timeout is not a prompt result", () => {
  it("does not attribute a timeout to the environment as a rate limit", () => {
    // It is graded, because a timeout may genuinely be the model looping. What
    // it must NOT do is vanish into a provider-error bucket, which would hide a
    // real behaviour difference behind "the gateway was slow".
    const classified = classifyTrialFailure("Task timed out after 120000ms");
    expect(classified.providerError).toBe(false);
    expect(classified.reason).toBe("task");
  });
});

describe("environmental failures stay environmental", () => {
  it("treats the live-lane quota wall as a provider error", () => {
    // Observed on the Gemini free tier: 20 requests/day, exhausted mid-probe.
    // Grading that as a task failure would make any arm using Gemini look
    // incapable when it was merely out of quota.
    const message =
      "You exceeded your current quota. Quota exceeded for metric: generate_content_free_tier_requests";
    expect(classifyTrialFailure(message).providerError).toBe(true);
  });

  it("treats an OpenRouter credit wall as a provider error, not a capability gap", () => {
    // Observed the same session: HTTP 402 on a paid model with no credits.
    const message = "Insufficient credits. This account never purchased credits.";
    expect(classifyTrialFailure(message).providerError).toBe(true);
  });

  it("treats a model that answers 403 for a listed model as environmental", () => {
    // Observed with thinkingmachines/inkling:free — listed in the registry,
    // refused by the gateway. Both arms would fail identically; it says
    // nothing about either prompt.
    const message = "thinkingmachines/inkling:free is only available on agentic harnesses";
    expect(classifyTrialFailure(message).providerError).toBe(true);
  });
});

describe("genuine capability differences are not excused", () => {
  it("keeps a wrong-answer failure graded", () => {
    // The whole point: a model that produced the wrong code must count against
    // the arm, or the harness would excuse every real regression.
    expect(classifyTrialFailure("check.sh exited 1").providerError).toBe(false);
    expect(classifyTrialFailure("AssertionError: expected 4 but got 5").providerError).toBe(false);
  });

  it("keeps a malformed-tool-call failure graded", () => {
    // Observed class: the model calls a tool with broken JSON. That is model
    // behaviour, and Anvil's own history repair handles it — excusing it would
    // hide a regression the repair loop is meant to absorb.
    expect(classifyTrialFailure("Malformed JSON in tool call input").providerError).toBe(false);
  });

  it("does not excuse a context overflow as environmental", () => {
    // A context overflow is caused by what was sent — a prompt that inflates
    // context, or a compaction failure. Blaming the provider would hide exactly
    // the class of defect a longer prompt could introduce.
    expect(classifyTrialFailure("context length exceeded").providerError).toBe(false);
  });
});
