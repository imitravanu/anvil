import {
  AgentSession,
  listSessions,
  loadSession,
  renameSession,
  searchSessions,
  SESSION_SEARCH_MIN_QUERY_CHARS,
} from "@anvil/core";
import type { CommandHandlerDeps } from "../types.js";
import { curtail, relativeTime } from "../../util/format.js";
import { SESSION_TITLE_MAX } from "../../util/displayLimits.js";

export function handleClearHistory(deps: CommandHandlerDeps): void {
  const { isBusy, printSystemMessage, providers, activeProviderId, sessionOptions, currentModel, broker, setSession, clearMessages } = deps;
  if (isBusy) {
    printSystemMessage("Cannot clear the conversation while a turn is in flight.");
    return;
  }
  const fresh = new AgentSession(providers[activeProviderId], {
    ...sessionOptions,
    model: currentModel,
    permissionBroker: broker,
  });
  broker.clearSessionApprovals();
  setSession(fresh);
  clearMessages();
  printSystemMessage("Conversation cleared (permission grants reset). The previous session can be resumed with /session.");
}

export function handleSessionList(deps: CommandHandlerDeps): void {
  const { printSystemMessage } = deps;
  const metas = listSessions();
  if (metas.length === 0) {
    printSystemMessage("No saved sessions.");
    return;
  }
  printSystemMessage(
    metas
      .map(
        (m) =>
          `${m.id.slice(0, 8)}  ${curtail(m.title, SESSION_TITLE_MAX)}  ·  ${m.model}  ·  ${relativeTime(m.updatedAt)}`
      )
      .join("\n")
  );
}

/**
 * `/session search <text>` — full-text search of saved transcripts. Titles are
 * unreliable (they default to a truncated first message) and file-level search
 * duplicates `git log`, so this matches the conversation itself.
 */
export function handleSessionSearch(deps: CommandHandlerDeps, query: string): void {
  const { printSystemMessage } = deps;
  const trimmed = query.trim();
  if (!trimmed) {
    printSystemMessage("Usage: /session search <text>");
    return;
  }
  if (trimmed.length < SESSION_SEARCH_MIN_QUERY_CHARS) {
    printSystemMessage(
      `Search needs at least ${SESSION_SEARCH_MIN_QUERY_CHARS} characters — one letter matches every session.`
    );
    return;
  }
  const matches = searchSessions(trimmed);
  if (matches.length === 0) {
    printSystemMessage(`No saved session mentions "${trimmed}".`);
    return;
  }
  const blocks = matches.map((m) => {
    const titleHit = m.matchedTitle ? " (title)" : "";
    const head = `${m.metadata.id.slice(0, 8)}  ${curtail(m.metadata.title, SESSION_TITLE_MAX)}  ·  ${relativeTime(m.metadata.updatedAt)}  ·  ${m.matchCount} message(s)${titleHit}`;
    const body = m.snippets.map((s) => `    ${s.role}: ${s.text}`);
    return [head, ...body].join("\n");
  });
  printSystemMessage(
    `${matches.length} session(s) mention "${trimmed}" — /session resume <id> to open one:\n${blocks.join("\n")}`
  );
}

export function handleSessionNew(deps: CommandHandlerDeps): void {
  const { isBusy, printSystemMessage, providers, activeProviderId, sessionOptions, currentModel, broker, setSession, clearMessages } = deps;
  if (isBusy) {
    printSystemMessage("Cannot start a new session while a turn is in flight.");
    return;
  }
  const fresh = new AgentSession(providers[activeProviderId], {
    ...sessionOptions,
    model: currentModel,
    permissionBroker: broker,
  });
  broker.clearSessionApprovals();
  setSession(fresh);
  clearMessages();
  printSystemMessage("Started a new session (permission grants reset).");
}

export function handleSessionResume(deps: CommandHandlerDeps, id?: string): void {
  const { isBusy, printSystemMessage, setIsSessionPickerOpen, resumeFromStored } = deps;
  if (isBusy) {
    printSystemMessage("Cannot resume a session while a turn is in flight.");
    return;
  }
  if (!id) {
    setIsSessionPickerOpen(true);
    return;
  }
  const stored = loadSession(id);
  if (!stored) {
    printSystemMessage(`No saved session found with id ${id}.`);
    return;
  }
  resumeFromStored(stored);
}

export function handleSessionRename(deps: CommandHandlerDeps, title: string): void {
  const { isBusy, printSystemMessage, session } = deps;
  if (isBusy) {
    printSystemMessage("Cannot rename the session while a turn is in flight.");
    return;
  }
  renameSession(session.id, title);
  session.title = title;
  printSystemMessage(`Session renamed to "${title}".`);
}

export function handleRetryLast(deps: CommandHandlerDeps, replacement?: string): void {
  const { isBusy, printSystemMessage, session, messages, replaceMessages, send } = deps;
  if (isBusy) {
    printSystemMessage("Cannot retry while a turn is in flight.");
    return;
  }
  const previous = session.popLastUserTurn();
  if (previous === null && !replacement) {
    printSystemMessage("Nothing to retry yet.");
    return;
  }
  const text = replacement || previous || "";
  const lastUserIdx = messages.map((m) => m.role).lastIndexOf("user");
  replaceMessages(lastUserIdx > 0 ? messages.slice(0, lastUserIdx) : []);
  printSystemMessage(replacement ? "Retrying with your corrected message." : "Retrying your last message.");
  void send(text);
}
