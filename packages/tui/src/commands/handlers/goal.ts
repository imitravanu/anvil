import type { CommandHandlerDeps } from "../types.js";

export function handleLaunchGoal(deps: CommandHandlerDeps, objective: string): void {
  const { isBusy, printSystemMessage, launchGoal } = deps;
  if (isBusy) {
    printSystemMessage("Cannot launch a goal while a turn is in flight.");
    return;
  }
  printSystemMessage(`🎯 Autonomous Mission Initiated: "${objective}"`);
  void launchGoal?.(objective);
}
