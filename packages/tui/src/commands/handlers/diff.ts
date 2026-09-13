import { getBranchDiff, createPullRequest, getErrorMessage } from "@anvil/core";
import type { CommandHandlerDeps } from "../types.js";
import { capLines } from "../../util/displayLimits.js";

export function handleShowDiff(deps: CommandHandlerDeps, branch?: string): void {
  const { isBusy, printSystemMessage, session, setIsDiffOpen, setBranchDiff } = deps;
  if (isBusy) {
    printSystemMessage("Cannot diff while a turn is in flight.");
    return;
  }
  if (branch) {
    void getBranchDiff(session.projectRoot, branch)
      .then((diff) => {
        if (setBranchDiff && setIsDiffOpen) {
          setBranchDiff({ branch, diff });
          setIsDiffOpen(true);
        } else {
          if (!diff.trim()) {
            printSystemMessage(`No differences between branch "${branch}" and HEAD.`);
          } else {
            printSystemMessage(capLines(diff.split("\n")).join("\n"));
          }
        }
      })
      .catch((err: unknown) => {
        printSystemMessage(`Diff against "${branch}" failed: ${getErrorMessage(err)}`);
      });
    return;
  }

  if (setBranchDiff) {
    setBranchDiff(null);
  }
  if (setIsDiffOpen) {
    setIsDiffOpen(true);
    return;
  }
  void session.summarizeChanges()
    .then((changes) => {
      if (changes.length === 0) {
        printSystemMessage("No file changes this session yet — /diff reviews write_file and edit_file edits.");
        return;
      }
      const shown = changes.slice(0, 8);
      const parts = shown.map((c) => {
        const mark = c.kind === "created" ? "+" : c.kind === "deleted" ? "−" : "~";
        const body = c.diff === null ? "(file deleted)" : capLines(c.diff.split("\n")).join("\n");
        return `${mark} ${c.path} (${c.kind})\n${body}`;
      });
      let msg = parts.join("\n\n");
      if (changes.length > shown.length) msg += `\n\n… +${changes.length - shown.length} more file(s)`;
      printSystemMessage(msg);
    })
    .catch((err: unknown) => {
      printSystemMessage(`Diff failed: ${getErrorMessage(err)}`);
    });
}

export function handleCreatePr(deps: CommandHandlerDeps): void {
  const { isBusy, printSystemMessage, session } = deps;
  if (isBusy) {
    printSystemMessage("Cannot create PR while a turn is in flight.");
    return;
  }
  printSystemMessage("Creating GitHub pull request (gh pr create --fill)...");
  void createPullRequest(session.projectRoot)
    .then((res) => {
      if (res.success) {
        printSystemMessage(`✓ Pull request created: ${res.url}`);
      } else {
        printSystemMessage(`✗ Pull request failed: ${res.error}`);
      }
    })
    .catch((err: unknown) => {
      printSystemMessage(`✗ Pull request failed: ${getErrorMessage(err)}`);
    });
}
