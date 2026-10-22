import { isRateLimitMessage } from "@imitravanu/anvil-core";

/**
 * Compact, actionable transcript rendering for provider errors. Raw provider
 * messages are often multi-line walls (quota dumps with docs URLs, nested
 * JSON); the transcript gets one headline + a next step. Returns the original
 * message (capped) when no friendly mapping applies — never fabricates.
 */
export function friendlyError(message: string): string {
  const retry = message.match(/retry in ([\d.]+)\s*s/i);
  if (!retry && /insufficient_quota|quota.*exhaust|free quota|insufficient.*(credit|balance)|payment|billing/i.test(message)) {
    return "Provider quota unavailable — check the account's quota or billing, or choose another provider with /model. Waiting may not resolve this.";
  }
  if (isRateLimitMessage(message)) {
    const wait = retry ? ` Retry in ~${Math.ceil(parseFloat(retry[1]))}s.` : "";
    return `Rate limit reached — the provider needs a short break.${wait} Wait it out or /model to another provider.`;
  }
  if (/\b401\b|unauthorized|invalid[ _-]api[ _-]?key|authentication/i.test(message)) {
    return "Authentication failed — the API key was rejected. Check it with /connect.";
  }
  if (/\b403\b|permission.*(denied|revoked)|forbidden/i.test(message)) {
    return "Access denied by the provider — the key may lack access to this model. Try /model or /connect.";
  }
  if (/context length|maximum context|token limit|too many tokens|prompt is too long/i.test(message)) {
    return "The conversation outgrew the model's context window. Start fresh with /clear, or /model to a larger-context model.";
  }
  if (/\b404\b|not found/i.test(message)) {
    return "The model or endpoint was not found — it may have been renamed or retired. Pick another with /model.";
  }
  if (/\b5\d{2}\b|bad gateway|service unavailable|overloaded/i.test(message)) {
    return "The provider is having trouble right now — try again in a moment.";
  }
  if (/timeout|timed out|ETIMEDOUT|ECONNRESET|fetch failed|network error/i.test(message)) {
    return "Connection interrupted — check the network and inspect /diff before retrying. Completed file changes are retained.";
  }
  // Unknown error: keep the first meaningful line, note the truncation.
  const lines = message.split("\n").filter((l) => l.trim() !== "");
  if (lines.length <= 2 && lines.join("\n").length <= 300) return message;
  return `${lines[0].trim()} … (+${lines.length - 1} more line${lines.length === 2 ? "" : "s"})`;
}
