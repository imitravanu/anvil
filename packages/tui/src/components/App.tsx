import { useCallback, useState } from "react";
import { Box, useStdout } from "ink";
import {
  AgentSession,
  type AgentOptions,
  type ConversationMessage,
  type ModelInfo,
  type ModelProvider,
  type ProviderId,
  type StoredSession,
  listSessions,
  loadSession,
  loadSettings,
  renameSession,
  saveSession,
  saveSettings,
} from "@anvil/core";
import type { TuiPermissionBroker } from "../permission/TuiPermissionBroker.js";
import { useAgentController, type DisplayMessage } from "../hooks/useAgentController.js";
import { usePermissionBroker } from "../hooks/usePermissionBroker.js";
import { ThemeContext } from "../theme/theme.js";
import { THEMES, isThemeName, type ThemeName } from "../theme/themes.js";
import { COMMANDS, parseCommand } from "../commands/registry.js";
import type { CommandContext } from "../commands/types.js";
import { Header } from "./Header.js";
import { InputBar } from "./InputBar.js";
import { MessageList } from "./MessageList.js";
import { ModelPicker } from "./ModelPicker.js";
import { PermissionPrompt } from "./PermissionPrompt.js";
import { SessionPicker } from "./SessionPicker.js";
import { StatusBar } from "./StatusBar.js";

export interface AppProps {
  session: AgentSession;
  broker: TuiPermissionBroker;
  providers: Record<ProviderId, ModelProvider>;
  providerId: ProviderId; // the provider `session` was constructed with
  model: string;
  // Options for constructing replacement sessions (/session new, resume).
  sessionOptions: Omit<AgentOptions, "permissionBroker" | "model">;
  // Theme name from settings.json, validated by the caller (default dark).
  initialTheme?: ThemeName;
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
      };
    })
    .filter((m): m is DisplayMessage => m !== null);
}

export function App({
  session: initialSession,
  broker,
  providers,
  providerId: initialProviderId,
  model,
  sessionOptions,
  initialTheme = "dark",
}: AppProps) {
  const [session, setSession] = useState(initialSession);
  const [activeProviderId, setActiveProviderId] = useState<ProviderId>(initialProviderId);
  const [currentModel, setCurrentModel] = useState(model);

  const {
    messages,
    isBusy,
    usage,
    send,
    cancel,
    printSystemMessage,
    clearMessages,
    replaceMessages,
    sentHistory,
  } = useAgentController(session);
  const { stdout } = useStdout();
  const rows = stdout?.rows ?? 24;

  const pendingPermission = usePermissionBroker(broker);
  const [isModelPickerOpen, setIsModelPickerOpen] = useState(false);
  const [isSessionPickerOpen, setIsSessionPickerOpen] = useState(false);
  const [themeName, setThemeName] = useState<ThemeName>(initialTheme);

  const applyTheme = (name: string) => {
    if (!isThemeName(name)) {
      printSystemMessage(
        `Unknown theme "${name}". Valid themes: ${Object.keys(THEMES).join(", ")}.`
      );
      return;
    }
    setThemeName(name);
    saveSettings({ ...loadSettings(), theme: name }); // persists across restarts
    printSystemMessage(`Theme set to ${name}.`);
  };

  /** Auto-save: called after every completed/cancelled turn and after /clear. */
  const persist = useCallback(() => {
    try {
      saveSession(session.toStoredSession(activeProviderId, currentModel));
    } catch {
      // disk failures must not take the chat down; the next turn will retry
    }
  }, [session, activeProviderId, currentModel]);

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
  };

  const handleSubmit = async (text: string) => {
    const parsed = parseCommand(text);
    if (parsed) {
      const command = COMMANDS.find((c) => c.name === parsed.name);
      const ctx: CommandContext = {
        clearHistory: () => {
          session.clearHistory();
          clearMessages();
          persist(); // keep the stored file in sync with the cleared history
        },
        openModelPicker: () => setIsModelPickerOpen(true),
        printSystemMessage,
        sessionList: () => {
          const metas = listSessions();
          if (metas.length === 0) {
            printSystemMessage("No saved sessions.");
            return;
          }
          printSystemMessage(
            metas
              .map((m) => `${m.id}  ${m.title}  (${m.model}, updated ${m.updatedAt})`)
              .join("\n")
          );
        },
        sessionNew: () => {
          if (isBusy) {
            printSystemMessage("Cannot start a new session while a turn is in flight.");
            return;
          }
          const fresh = new AgentSession(providers[activeProviderId], {
            ...sessionOptions,
            model: currentModel,
            permissionBroker: broker,
          });
          setSession(fresh);
          clearMessages();
          printSystemMessage("Started a new session.");
        },
        sessionResume: (id?: string) => {
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
        },
        sessionRename: (title: string) => {
          renameSession(session.id, title);
          printSystemMessage(`Session renamed to "${title}".`);
        },
        setTheme: applyTheme,
      };
      if (command) command.run(parsed.args, ctx);
      else printSystemMessage(`Unknown command: /${parsed.name}. Try /help.`);
      return;
    }
    // Regular turn: run it, then auto-save regardless of how it ended
    // (turn_complete, cancelled, or error).
    await send(text);
    persist();
  };

  const handleModelSelect = (provider: ModelProvider, modelInfo: ModelInfo) => {
    const result = session.switchModel(provider, modelInfo.id);
    if (result.historyCleared) {
      printSystemMessage(
        `Switched to ${provider.id}/${modelInfo.id} — conversation history was cleared (different provider).`
      );
    } else {
      printSystemMessage(`Switched to ${provider.id}/${modelInfo.id}.`);
    }
    setActiveProviderId(provider.id);
    setCurrentModel(modelInfo.id);
    setIsModelPickerOpen(false);
  };

  const handleSessionPick = (id: string) => {
    setIsSessionPickerOpen(false);
    const stored = loadSession(id);
    if (!stored) {
      printSystemMessage(`No saved session found with id ${id}.`);
      return;
    }
    resumeFromStored(stored);
  };

  return (
    <ThemeContext.Provider value={THEMES[themeName]}>
      <Box flexDirection="column" height={rows} width={stdout?.columns ?? 80}>
        <Header model={currentModel} />
        <MessageList messages={messages} />
        {/* Overlays take over keyboard input — InputBar is not rendered while one is open,
            so keystrokes can never leak into it. */}
        {pendingPermission ? (
          <PermissionPrompt request={pendingPermission} broker={broker} />
        ) : isModelPickerOpen ? (
          <ModelPicker
            providers={providers}
            currentModelId={currentModel}
            onSelect={handleModelSelect}
            onClose={() => setIsModelPickerOpen(false)}
          />
        ) : isSessionPickerOpen ? (
          <SessionPicker
            onSelect={handleSessionPick}
            onClose={() => setIsSessionPickerOpen(false)}
          />
        ) : (
          <InputBar
            isBusy={isBusy}
            onSubmit={handleSubmit}
            onCancel={cancel}
            sentHistory={sentHistory}
          />
        )}
        <StatusBar model={currentModel} isBusy={isBusy} usage={usage} />
      </Box>
    </ThemeContext.Provider>
  );
}