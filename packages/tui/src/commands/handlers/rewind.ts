import { getErrorMessage } from "@anvil/core";
import type { CommandHandlerDeps } from "../types.js";
import { formatRewindList, formatRewindResult } from "../../util/rewind.js";

export function handleRewind(deps: CommandHandlerDeps, idText?: string): void {
  const { isBusy, printSystemMessage, session, setIsRewindOpen, persist } = deps;
  if (isBusy) {
    printSystemMessage("Cannot rewind while a turn is in flight.");
    return;
  }
  if (idText === undefined) {
    if (setIsRewindOpen) {
      setIsRewindOpen(true);
      return;
    }
    printSystemMessage(formatRewindList(session.getCheckpoints()));
    return;
  }
  const idTextTrimmed = idText.trim();
  if (!/^\d+$/.test(idTextTrimmed)) {
    printSystemMessage(`Usage: /rewind <n> — n is a checkpoint number from /rewind.`);
    return;
  }
  const id = Number(idTextTrimmed);
  if (!Number.isSafeInteger(id) || id <= 0) {
    printSystemMessage(`Usage: /rewind <n> — n is a checkpoint number from /rewind.`);
    return;
  }
  void session.rewind(id).then((result) => {
    printSystemMessage(formatRewindResult(result));
    persist();
  }).catch((err: unknown) => {
    printSystemMessage(`Rewind failed: ${getErrorMessage(err)}`);
  });
}
