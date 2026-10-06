import { DEFAULT_MAX_TOKENS } from "./constants.js";
import { buildSystemPrompt } from "./rules.js";

/**
 * The base prompt every Anvil surface starts from.
 *
 * This was previously a string literal duplicated at each call site. The eval
 * lane had drifted onto a DIFFERENT prompt than the one that ships, so the
 * recorded live score measured an agent no user ever runs. One constant, one
 * prompt — see PHASE-38-ROADMAP.md §38.1.
 *
 * Thinness here is a real, measured open boundary, not an oversight: the
 * behavior this prompt is supposed to elicit is 38.5, gated behind the 38.4
 * A/B harness. Do not grow this string without a recorded harness receipt.
 */
export const ANVIL_BASE_SYSTEM_PROMPT =
  "You are Anvil, a terminal coding agent. Be concise.";

export interface AnvilAgentProfile {
  /** Fully assembled: base + plugin prompts + project rules + project memory. */
  systemPrompt: string;
  /** Output-token ceiling for one assistant round. */
  maxTokens: number;
  /**
   * Closed-loop verification. ON for every user-facing surface: after a
   * mutation, the detected test runner gates the turn.
   */
  autoVerify: boolean;
}

export interface AgentProfileOptions {
  /** Plugin prompt fragments, folded in after the base prompt. */
  readonly pluginPrompts?: readonly string[];
  /** Override the output budget. `undefined` uses DEFAULT_MAX_TOKENS. */
  readonly maxTokens?: number;
  /**
   * Override the verify flag. Production surfaces never pass this; the eval
   * harness does, and PHASE-38-ROADMAP.md §4 records why.
   */
  readonly autoVerify?: boolean;
}

/**
 * The one place the agent's base prompt, output budget, and verify flag are
 * assembled. Every surface that constructs an `AgentSession` for a real user
 * goes through here, so the eval lane cannot silently measure a different
 * agent than the one that ships.
 */
export function buildAnvilAgentProfile(
  projectRoot: string,
  options: AgentProfileOptions = {}
): AnvilAgentProfile {
  const {
    pluginPrompts = [],
    maxTokens = DEFAULT_MAX_TOKENS,
    autoVerify = true,
  } = options;

  // task.json/eval seams pass maxTokens straight through: 0, negative, NaN,
  // and fractional values all 400 at the provider. Floor to the default —
  // only the floor is ours to set; no upper cap (providers 400 the absurd).
  const saneMaxTokens =
    Number.isFinite(maxTokens) && maxTokens >= 1 ? Math.floor(maxTokens) : DEFAULT_MAX_TOKENS;

  const base =
    pluginPrompts.length > 0
      ? `${ANVIL_BASE_SYSTEM_PROMPT}\n\n${pluginPrompts.join("\n\n")}`
      : ANVIL_BASE_SYSTEM_PROMPT;

  return {
    systemPrompt: buildSystemPrompt(base, projectRoot),
    maxTokens: saneMaxTokens,
    autoVerify,
  };
}
