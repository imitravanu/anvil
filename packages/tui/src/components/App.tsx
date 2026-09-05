import { useCallback, useState } from "react";
import { Box, Text, useStdout } from "ink";
import {
  AgentSession,
  createProviders,
  loadCredentials,
  loadSettings,
  loadSession,
  listSessions,
  renameSession,
  saveSession,
  saveSettings,
  type AgentOptions,
  type ConversationMessage,
  type McpServerConnection,
  type ModelInfo,
  type ModelProvider,
  type ProviderId,
  type StoredSession,
} from "@anvil/core";
import type { TuiPermissionBroker } from "../permission/TuiPermissionBroker.js";
import { useAgentController, type DisplayMessage } from "../hooks/useAgentController.js";
import { usePermissionBroker } from "../hooks/usePermissionBroker.js";
import { ThemeContext, useTheme } from "../theme/theme.js";
import { PROVIDER_LABELS } from "../util/labels.js";
import { THEMES, isThemeName, type Theme } from "../theme/themes.js";
import { loadCustomThemes } from "../theme/custom.js";
import { COMMANDS, parseCommand } from "../commands/registry.js";
import type { CommandContext } from "../commands/types.js";
import { formatLedger } from "../util/ledger.js";
import { formatMcpStatus } from "../util/mcp.js";
import { formatRewindList, formatRewindResult } from "../util/rewind.js";
import { Header } from "./Header.js";
import { InputBar } from "./InputBar.js";
import { MessageList } from "./MessageList.js";
import { ModelPicker } from "./ModelPicker.js";
import { PermissionPrompt } from "./PermissionPrompt.js";
import { FirstRunSetup } from "./FirstRunSetup.js";
import { PlanLine } from "./PlanLine.js";
import { SessionPicker } from "./SessionPicker.js";
import { StatusBar } from "./StatusBar.js";

// Provider labels live in util/labels.ts (Phase 8 C1) — single source of truth.

// Phase 10: live MCP state, owned by the CLI boot (connections mutate in
// place on reconnect so the executor never goes stale).
export interface McpAppState {
  list: () => McpServerConnection[];
  notices: string[];
  reconnect: () => Promise<{ problems: string[]; connected: number; tools: number }>;
}

export interface AppProps {
  session: AgentSession;
  broker: TuiPermissionBroker;
  providers: Record<ProviderId, ModelProvider>;
  providerId: ProviderId; // the provider `session` was constructed with
  model: string;
  // Options for constructing replacement sessions (/session new, resume).
  sessionOptions: Omit<AgentOptions, "permissionBroker" | "model">;
  // Theme name from settings.json, validated by the caller (default dark).
  // May name a built-in or a ~/.anvil/themes.json custom theme.
  initialTheme?: string;
  // MCP servers (absent = none configured; /mcp still explains mcp.json).
  mcp?: McpAppState;
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

export function App({
  session: initialSession,
  broker,
  providers: initialProviders,
  providerId: initialProviderId,
  model,
  sessionOptions,
  initialTheme = "dark",
  mcp,
}: AppProps) {
  const [session, setSession] = useState(initialSession);
  const [providers, setProviders] = useState(initialProviders);
  const [activeProviderId, setActiveProviderId] = useState<ProviderId>(initialProviderId);
  const [currentModel, setCurrentModel] = useState(model);

  const {
    messages,
    isBusy,
    usage,
    plan,
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
  const [isConnectOpen, setIsConnectOpen] = useState(false);
  const [themeName, setThemeName] = useState<string>(initialTheme);
  // U13: user themes from ~/.anvil/themes.json, loaded once. Built-ins win
  // on name conflicts (the loader rejects shadows, this is belt-and-braces).
  const [customThemes] = useState(() => loadCustomThemes());
  const resolveTheme = (name: string): Theme =>
    customThemes.themes[name] ?? (isThemeName(name) ? THEMES[name] : THEMES.dark);
  const themeNames = [...Object.keys(THEMES), ...Object.keys(customThemes.themes)];
  // U6: full tool-output display, toggled by /expand. Session-scoped,
  // never persisted — a resumed session starts compact.
  const [expandTools, setExpandTools] = useState(false);

  const applyTheme = (name: string) => {
    if (!name) {
      const problems = customThemes.problems.map((p) => `${p.name}: ${p.error}`).join("; ");
      printSystemMessage(
        `Usage: /theme <name>. Valid themes: ${themeNames.join(", ")}.` +
        (problems ? ` Custom theme problems: ${problems}` : "")
      );
      return;
    }
    if (!isThemeName(name) && !(name in customThemes.themes)) {
      printSystemMessage(
        `Unknown theme "${name}". Valid themes: ${themeNames.join(", ")}.`
      );
      return;
    }
    setThemeName(name);
    saveSettings({ ...loadSettings(), theme: name }); // persists across restarts
    printSystemMessage(`Theme set to ${name}${isThemeName(name) ? "" : " (custom)"}.`);
  };

  /** Auto-save after every completed or cancelled turn. */
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
    // Phase 8 (A.1.4): re-emit the persisted plan once so the user sees it.
    if (restored.plan) printSystemMessage(`Plan: ${restored.plan}`);
  };

  const handleSubmit = async (text: string) => {
    const parsed = parseCommand(text);
    if (parsed) {
      const command = COMMANDS.find((c) => c.name === parsed.name);
      const ctx: CommandContext = {
        clearHistory: () => {
          if (isBusy) {
            printSystemMessage("Cannot clear the conversation while a turn is in flight.");
            return;
          }
          // Keep the old session file intact so /clear is recoverable via
          // /session resume, and give the cleared conversation a new session id.
          const fresh = new AgentSession(providers[activeProviderId], {
            ...sessionOptions,
            model: currentModel,
            permissionBroker: broker,
          });
          setSession(fresh);
          clearMessages();
          printSystemMessage("Conversation cleared. The previous session can be resumed with /session.");
        },
        openModelPicker: () => {
          if (isBusy) {
            printSystemMessage("Cannot switch models while a turn is in flight.");
            return;
          }
          setIsModelPickerOpen(true);
        },
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
        openConnect: () => {
          if (isBusy) {
            printSystemMessage("Cannot connect a provider while a turn is in flight.");
            return;
          }
          setIsConnectOpen(true);
        },
        showLedger: () => {
          printSystemMessage(formatLedger(session.getRunLedger()));
        },
        toggleExpand: () => {
          setExpandTools((prev) => {
            printSystemMessage(prev ? "Tool output expansion off." : "Tool output expansion on — full results shown.");
            return !prev;
          });
        },
        rewind: (idText?: string) => {
          if (isBusy) {
            printSystemMessage("Cannot rewind while a turn is in flight.");
            return;
          }
          if (idText === undefined) {
            printSystemMessage(formatRewindList(session.getCheckpoints()));
            return;
          }
          const id = Number(idText);
          if (!Number.isInteger(id) || id <= 0) {
            printSystemMessage(`Usage: /rewind <n> — n is a checkpoint number from /rewind.`);
            return;
          }
          void session.rewind(id).then((result) => {
            printSystemMessage(formatRewindResult(result));
            persist();
          });
        },
        mcp: (sub?: string) => {
          const conns = mcp?.list() ?? [];
          const notices = mcp?.notices ?? [];
          if (sub === undefined || sub === "status") {
            printSystemMessage(formatMcpStatus(conns, notices));
            return;
          }
          if (sub === "reconnect") {
            if (isBusy) {
              printSystemMessage("Cannot reconnect MCP servers while a turn is in flight.");
              return;
            }
            if (!mcp) {
              printSystemMessage(formatMcpStatus([], notices));
              return;
            }
            printSystemMessage("Reconnecting MCP servers...");
            void mcp.reconnect().then((report) => {
              const fresh = [...notices, ...report.problems.map((p) => `MCP ${p}`)];
              printSystemMessage(
                `Reconnected: ${report.connected} server(s), ${report.tools} tool(s). ` +
                `(New tools need a restart to enter this session.)\n` +
                formatMcpStatus(mcp.list(), fresh)
              );
            });
            return;
          }
          printSystemMessage(`Unknown /mcp subcommand: ${sub}. Try /mcp or /mcp reconnect.`);
        },
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
    const pricingTag = modelInfo.isFree ? " [FREE]" : modelInfo.isFree === false ? " [PAID]" : "";
    if (result.historyCleared) {
      printSystemMessage(
        `Switched to ${provider.id}/${modelInfo.id}${pricingTag} — conversation history was cleared (different provider).`
      );
    } else {
      printSystemMessage(`Switched to ${provider.id}/${modelInfo.id}${pricingTag}.`);
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

  // /connect finished: refresh provider instances from the freshly-written key
  // and hot-apply it if it belongs to the active provider (same provider id,
  // so switchModel keeps history while swapping the underlying API key).
  const handleConnectDone = (providerId: ProviderId) => {
    const refreshed = createProviders(loadCredentials());
    setProviders(refreshed);
    setIsConnectOpen(false);
    const label = PROVIDER_LABELS[providerId] ?? providerId;
    if (providerId === activeProviderId) {
      session.switchModel(refreshed[providerId], currentModel);
      printSystemMessage(`✓ ${label} reconnected with the new key.`);
    } else {
      printSystemMessage(`✓ ${label} connected. Use /model to switch to it.`);
    }
  };

  return (
    <ThemeContext.Provider value={resolveTheme(themeName)}>
      {/* One outer frame wraps every zone — header, messages, input/status — so
          the app reads as a single window. The border color comes straight from
          the theme object because App is the theme *provider*; everything below
          this Box consumes the same colors via useTheme(). */}
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor={resolveTheme(themeName).colors.border}
        height={rows}
        width={stdout?.columns ?? 80}
      >
        <Header model={currentModel} isBusy={isBusy} />
        <Divider />
        <Box flexDirection="column" flexGrow={1} minHeight={0}>
          <MessageList messages={messages} model={currentModel} expandTools={expandTools} />
        </Box>
        <Divider />
        {/* Phase 8.5 (U1): the agent's current plan stays visible above the
            input until it changes or the session changes. */}
        {plan && <PlanLine plan={plan} />}
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
        ) : isConnectOpen ? (
          <FirstRunSetup
            title="Connect a provider — pick one, paste its API key, done."
            onDone={handleConnectDone}
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

/** Full-width horizontal rule separating the frame's zones. Width accounts for
 * the outer frame's two border columns so the rule spans the content exactly. */
function Divider() {
  const { stdout } = useStdout();
  const theme = useTheme();
  const width = Math.max(0, (stdout?.columns ?? 80) - 2);
  return <Text dimColor>{"─".repeat(width)}</Text>;
}
