import type { CommandHandlerDeps } from "../types.js";

export function handleLaunchGoal(deps: CommandHandlerDeps, objective: string): void {
  const { isBusy, printSystemMessage, launchGoal } = deps;
  if (isBusy) {
    printSystemMessage("Cannot launch a goal while a turn is in flight.");
    return;
  }
  if (deps.hasQueuedMessages) {
    printSystemMessage("Review queued messages with Ctrl+Q before starting a mission.");
    return;
  }
  printSystemMessage(`🎯 Autonomous Mission Initiated: "${objective}"`);
  void launchGoal?.(objective);
}
