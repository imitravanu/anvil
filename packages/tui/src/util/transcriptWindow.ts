import type { DisplayMessage } from "../hooks/useAgentController.js";

/**
 * Scrollback honesty for the bounded transcript window: the flex clip hides
 * overflowing content silently, so we estimate how many OLDEST messages do
 * not fit and surface a "… N earlier messages" line. Heuristic on purpose —
 * each message's rendered height is approximated from its content (markdown
 * collapses some lines, wraps others; ±1 line per message is acceptable for
 * an indicator).
 */
export function estimatedLines(message: DisplayMessage, width: number, expandTools = false): number {
  // Text wraps at roughly the content width; count code-point-aware chars.
  const usable = Math.max(20, width - 6);
  let lines = 1; // role label ("anvil" / "❯ you" / "ℹ")
  if (message.text) {
    for (const para of message.text.split("\n")) {
      lines += Math.max(1, Math.ceil(Array.from(para).length / usable));
    }
  }
  // Collapsed cards are one row each (they are width-capped); expanded tool
  // bodies and verification cards render many more rows than their count —
  // ignoring them made the estimator report 0 hidden while the flex clip ate
  // the top of the transcript. Heuristic caps, matching ExpandedLines' bounds.
  for (const call of message.toolCalls) {
    lines += expandTools && call.output !== undefined ? 10 : 1;
  }
  lines += message.subAgents.length;
  lines += (message.verifications?.length ?? 0) * 6;
  if (message.errorText) lines += 1;
  return lines + 1; // blank margin between turns
}

/** Count of oldest messages that do not fit the given row budget. Pure. */
export function hiddenMessageCount(
  messages: readonly DisplayMessage[],
  width: number,
  rowBudget: number,
  expandTools = false
): number {
  // The "… N earlier messages" indicator itself occupies one row inside the
  // clipped region — reserve it so it can't push the newest message's last
  // line out at the threshold.
  const effectiveBudget = Math.max(1, rowBudget - 1);
  let used = 0;
  let hidden = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    used += estimatedLines(messages[i], width, expandTools);
    if (used > effectiveBudget) {
      hidden = i + 1;
      break;
    }
  }
  return hidden;
}
