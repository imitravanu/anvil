import {
  AgentSession,
  saveSession,
  type AgentOptions,
  type ConversationMessage,
  type ModelProvider,
  type ProviderId,
  type StoredSession,
} from "@anvil/core";
import type { TuiPermissionBroker } from "../permission/TuiPermissionBroker.js";
import type { DisplayMessage } from "./useAgentController.js";
import { COMMANDS, makeHandlers, parseCommand } from "../commands/registry.js";
import type { CommandContext } from "../commands/types.js";
import type { McpAppState } from "../components/App.js";

export interface UseSessionCommandsDeps {
  session: AgentSession;
  providers: Record<ProviderId, ModelProvider>;
  activeProviderId: ProviderId;
  currentModel: string;
  sessionOptions: Omit<AgentOptions, "permissionBroker" | "model">;
  broker: TuiPermissionBroker;
  mcp?: McpAppState;
  isBusy: boolean;
  messages: DisplayMessage[];
  printSystemMessage: (text: string) => void;
  clearMessages: () => void;
  replaceMessages: (seed: DisplayMessage[]) => void;
  applyTheme: (name: string) => void;
  setSession: React.Dispatch<React.SetStateAction<AgentSession>>;
  setActiveProviderId: React.Dispatch<React.SetStateAction<ProviderId>>;
  setCurrentModel: React.Dispatch<React.SetStateAction<string>>;
  setIsModelPickerOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setIsSessionPickerOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setIsConnectOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setIsThemePickerOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setExpandTools: React.Dispatch<React.SetStateAction<boolean>>;
  send: (text: string) => Promise<void>;
}

export interface UseSessionCommandsResult {
  persist: () => void;
  resumeFromStored: (stored: StoredSession) => void;
  ctx: CommandContext;
  handleSubmit: (text: string) => Promise<void>;
}

/** Build display messages from a stored history (text parts only). */
function seedFromHistory(history: ConversationMessage[]): DisplayMessage[] {
  return history
    .map((msg): DisplayMessage | null => {
      const text = msg.content
        .filter((c) => c.type === "text")
        .map((c) => (c as { text: string }).text)
        .join("\n");
      if (!text) return null; // tool_call / tool_result parts are not replayed into the view
      return {
        id: `${msg.role}-${Math.random().toString(36).slice(2)}`,
        role: msg.role,
        text,
        streaming: false,
        toolCalls: [],
        subAgents: [],
      };
    })
    .filter((m): m is DisplayMessage => m !== null);
}

/**
 * Session lifecycle + slash-command wiring extracted from App (P3 split).
 * The ctx object is built fresh every render (no memo) to preserve the
 * fresh-closure behavior the guards (isBusy, session identity) depend on.
 */
export function useSessionCommands(deps: UseSessionCommandsDeps): UseSessionCommandsResult {
  const {
    session,
    providers,
    activeProviderId,
    currentModel,
    sessionOptions,
    broker,
    mcp,
    isBusy,
    messages,
    printSystemMessage,
    clearMessages,
    replaceMessages,
    applyTheme,
    setSession,
    setActiveProviderId,
    setCurrentModel,
    setIsModelPickerOpen,
    setIsSessionPickerOpen,
    setIsConnectOpen,
    setIsThemePickerOpen,
    setExpandTools,
    send,
  } = deps;

  /** Auto-save after every completed or cancelled turn. */
  const persist = () => {
    try {
      saveSession(session.toStoredSession(activeProviderId, currentModel));
    } catch {
      // disk failures must not take the chat down; the next turn will retry
    }
  };

  const resumeFromStored = (stored: StoredSession) => {
    const provider = providers[stored.metadata.providerId as ProviderId];
    if (!provider) {
      printSystemMessage(`Unknown provider "${stored.metadata.providerId}" in stored session.`);
      return;
    }
    const restored = new AgentSession(
      provider,
      { ...sessionOptions, model: stored.metadata.model, permissionBroker: broker },
      stored
    );
    setSession(restored);
    setActiveProviderId(stored.metadata.providerId as ProviderId);
    setCurrentModel(stored.metadata.model);
    clearMessages();
    replaceMessages(seedFromHistory(stored.history));
    printSystemMessage(`Resumed "${stored.metadata.title}" (${stored.metadata.model}).`);
    // re-emit the persisted plan once so the user sees it.
    if (restored.plan) printSystemMessage(`Plan: ${restored.plan}`);
  };

  const ctx = makeHandlers({
    session,
    providers,
    activeProviderId,
    currentModel,
    sessionOptions,
    broker,
    mcp,
    isBusy,
    messages,
    printSystemMessage,
    clearMessages,
    replaceMessages,
    persist,
    resumeFromStored,
    applyTheme,
    setSession,
    setIsModelPickerOpen,
    setIsSessionPickerOpen,
    setIsConnectOpen,
    setIsThemePickerOpen,
    setExpandTools,
    send,
  });

  const handleSubmit = async (text: string) => {
    const parsed = parseCommand(text);
    if (parsed) {
      const command = COMMANDS.find((c) => c.name === parsed.name);
      if (command) command.run(parsed.args, ctx);
      else printSystemMessage(`Unknown command: /${parsed.name}. Try /help.`);
      return;
    }
    // Regular turn: run it, then auto-save regardless of how it ended
    // (turn_complete, cancelled, or error).
    await send(text);
    persist();
  };

  return { persist, resumeFromStored, ctx, handleSubmit };
}
