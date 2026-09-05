import type { DisplayMessage } from "../hooks/useAgentController.js";

/**
 * Scrollback honesty for the bounded transcript window: the flex clip hides
 * overflowing content silently, so we estimate how many OLDEST messages do
 * not fit and surface a "… N earlier messages" line. Heuristic on purpose —
 * each message's rendered height is approximated from its content (markdown
 * collapses some lines, wraps others; ±1 line per message is acceptable for
 * an indicator).
 */
export function estimatedLines(message: DisplayMessage, width: number): number {
  // Text wraps at roughly the content width; count code-point-aware chars.
  const usable = Math.max(20, width - 6);
  let lines = 1; // role label ("anvil" / "❯ you" / "ℹ")
  if (message.text) {
    for (const para of message.text.split("\n")) {
      lines += Math.max(1, Math.ceil(Array.from(para).length / usable));
    }
  }
  lines += message.toolCalls.length;
  lines += message.subAgents.length;
  if (message.errorText) lines += 1;
  return lines + 1; // blank margin between turns
}

/** Count of oldest messages that do not fit the given row budget. Pure. */
export function hiddenMessageCount(
  messages: readonly DisplayMessage[],
  width: number,
  rowBudget: number
): number {
  let used = 0;
  let hidden = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    used += estimatedLines(messages[i], width);
    if (used > rowBudget) {
      hidden = i + 1;
      break;
    }
  }
  return hidden;
}
