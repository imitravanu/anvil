import { getErrorMessage } from "@anvil/core";
import type { DisplayMessage } from "../../hooks/useAgentController.js";
import { copyToClipboard } from "../../util/clipboard.js";
import type { CommandHandlerDeps } from "../types.js";

/**
 * DW-4.11 — find the newest fenced code block in the transcript (assistant
 * preferred, any role as fallback). Pure — unit-tested without a terminal.
 */
export function findLastCodeBlock(messages: readonly DisplayMessage[]): { language: string; code: string } | null {
  // Newest first, assistant messages before other roles (stable within each).
  const ordered = [...messages].reverse();
  const assistants = ordered.filter((m) => m.role === "assistant");
  const rest = ordered.filter((m) => m.role !== "assistant");
  for (const message of [...assistants, ...rest]) {
    const match = message.text.match(/```(\w*)\n([\s\S]*?)```/);
    if (match && (match[2] ?? "").trim().length > 0) {
      return { language: match[1] ?? "", code: match[2].replace(/\n$/, "") };
    }
  }
  return null;
}

/** /copy — copy the newest code block to the system clipboard (OSC 52). */
export function handleCopy(deps: CommandHandlerDeps): void {
  const found = findLastCodeBlock(deps.messages);
  if (!found) {
    deps.printSystemMessage("Nothing to copy — no fenced code block in the transcript yet.");
    return;
  }
  try {
    const result = copyToClipboard(found.code);
    if (result.ok) {
      deps.printSystemMessage(
        `Copied ${result.bytes} byte${result.bytes === 1 ? "" : "s"}${found.language ? ` (${found.language})` : ""} to the clipboard.`
      );
    } else if (result.reason === "too-large") {
      deps.printSystemMessage(`Code block too large for OSC 52 (${result.bytes} bytes) — not copied.`);
    } else if (result.reason === "not-a-tty") {
      deps.printSystemMessage("Clipboard needs a real terminal (not a pipe) — not copied.");
    } else {
      deps.printSystemMessage("Clipboard copy failed — not copied.");
    }
  } catch (err: unknown) {
    deps.printSystemMessage(`Clipboard copy failed: ${getErrorMessage(err)}`);
  }
}
