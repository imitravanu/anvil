import type { DisplayMessage } from "../hooks/useAgentController.js";
import { parseMarkdownText } from "../markdown/renderMarkdown.js";
import {
  CODE_HEAD_LINES,
  CODE_TAIL_LINES,
  markdownBlockSpaced,
} from "./displayLimits.js";

/**
 * Scrollback honesty for the bounded transcript window: the flex clip hides
 * overflowing content silently, so we estimate how many OLDEST messages do
 * not fit and surface a "… N earlier messages" line. Heuristic on purpose —
 * each message's rendered height is approximated from its content; ±1 line
 * per message is acceptable for an indicator. Settled assistant turns are
 * estimated through the real markdown parser so the count tracks what
 * MarkdownView actually renders (windowed code blocks, tables, spacing).
 */
export function estimatedLines(message: DisplayMessage, width: number, expandTools = false): number {
  // Text wraps at roughly the content width; count code-point-aware chars.
  const usable = Math.max(20, width - 6);
  let lines = 1; // role label ("anvil" / "❯ you" / "ℹ")
  if (message.text) {
    if (message.role === "assistant" && !message.streaming) {
      lines += estimateMarkdownLines(message.text, usable);
    } else {
      for (const para of message.text.split("\n")) {
        lines += Math.max(1, Math.ceil(Array.from(para).length / usable));
      }
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

/** Rows MarkdownView renders for a settled assistant text, mirroring its caps. */
function estimateMarkdownLines(text: string, usable: number): number {
  const blocks = parseMarkdownText(text);
  let lines = 0;
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    if (markdownBlockSpaced(block.kind, blocks[i - 1]?.kind)) lines += 1;
    switch (block.kind) {
      case "code": {
        const n = block.code.split("\n").length;
        lines +=
          n > CODE_HEAD_LINES + CODE_TAIL_LINES + 2
            ? CODE_HEAD_LINES + 1 + CODE_TAIL_LINES // head + omission marker + tail
            : n;
        break;
      }
      case "table":
        lines += 2 + block.rows.length; // header + rule + rows
        break;
      case "links":
        lines += block.links.length;
        break;
      case "hr":
        lines += 1;
        break;
      case "list": {
        // Hanging indent: continuations wrap at (usable - marker column).
        const prefix = Math.min(block.depth, 4) * 2 + (block.marker === "•" ? 2 : 3);
        const plain = block.spans.map((s) => s.text).join("");
        lines += Math.max(1, Math.ceil(Array.from(plain).length / Math.max(1, usable - prefix)));
        break;
      }
      default: {
        const plain = block.spans.map((s) => s.text).join("");
        lines += Math.max(1, Math.ceil(Array.from(plain).length / usable));
        break;
      }
    }
  }
  return lines === 0 ? 1 : lines;
}

/** Count of oldest messages that do not fit the given row budget. Pure. */
export function hiddenMessageCount(
  messages: readonly DisplayMessage[],
  width: number,
  rowBudget: number,
  expandTools = false
): number {
  // The "… N earlier messages" indicator occupies one row above the clipped
  // list — reserve it so it can't push the newest message's last line out at
  // the threshold.
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
