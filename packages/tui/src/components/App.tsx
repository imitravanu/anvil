import { useState } from "react";
import { Box, Text, useStdout } from "ink";
import {
  AgentSession,
  createProviders,
  loadCredentials,
  loadSession,
  type AgentOptions,
  type McpServerConnection,
  type ModelInfo,
  type ModelProvider,
  type ProviderId,
} from "@anvil/core";
import type { TuiPermissionBroker } from "../permission/TuiPermissionBroker.js";
import { useAgentController } from "../hooks/useAgentController.js";
import { usePermissionBroker } from "../hooks/usePermissionBroker.js";
import { useThemeManager } from "../hooks/useThemeManager.js";
import { useSessionCommands } from "../hooks/useSessionCommands.js";
import { ThemeContext, useTheme } from "../theme/theme.js";
import { PROVIDER_LABELS } from "../util/labels.js";
import { formatPricingTag } from "../util/format.js";
import { Header } from "./Header.js";
import { InputBar } from "./InputBar.js";
import { MessageList } from "./MessageList.js";
import { ModelPicker } from "./ModelPicker.js";
import { PermissionPrompt } from "./PermissionPrompt.js";
import { FirstRunSetup } from "./FirstRunSetup.js";
import { PlanLine } from "./PlanLine.js";
import { SessionPicker } from "./SessionPicker.js";
import { StatusBar } from "./StatusBar.js";

// Provider labels live in util/labels.ts — single source of truth.

// live MCP state, owned by the CLI boot (connections mutate in
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
  // Basis height for the message list: everything that is ALWAYS on screen —
  // outer frame border (2), header (1), two dividers (2), status bar (1),
  // bordered input (3) — leaves the rest for the transcript. PlanLine and the
  // taller overlays take their rows from the list via its flexShrink, so the
  // basis only has to be right for the plain input state.
  const listBasis = Math.max(3, rows - 9);

  const pendingPermission = usePermissionBroker(broker);
  const [isModelPickerOpen, setIsModelPickerOpen] = useState(false);
  const [isSessionPickerOpen, setIsSessionPickerOpen] = useState(false);
  const [isConnectOpen, setIsConnectOpen] = useState(false);
  // full tool-output display, toggled by /expand. Session-scoped,
  // never persisted — a resumed session starts compact.
  const [expandTools, setExpandTools] = useState(false);

  const { themeName, resolveTheme, applyTheme } = useThemeManager({ initialTheme, printSystemMessage });

  const { handleSubmit, resumeFromStored } = useSessionCommands({
    session,
    providers,
    activeProviderId,
    currentModel,
    sessionOptions,
    broker,
    mcp,
    isBusy,
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
    setExpandTools,
    send,
  });




  const handleModelSelect = (provider: ModelProvider, modelInfo: ModelInfo) => {
    const result = session.switchModel(provider, modelInfo.id);
    const pricingTag = formatPricingTag(modelInfo.isFree);
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
        {/* Every fixed-height zone keeps its rows: each component's root Box
            is flexShrink={0} (see components) and the bare Divider text is
            wrapped here. When content exceeds the frame (long transcripts,
            tall overlays), the message list is the ONLY element allowed to
            shrink — Ink's CSS-style default flex-shrink:1 otherwise compresses
            everything at once, which is what made turns and chrome overwrite
            each other's rows. */}
        <Header model={currentModel} isBusy={isBusy} />
        <Box flexShrink={0}>
          <Divider />
        </Box>
        <Box flexDirection="column" flexGrow={1} flexShrink={1} minHeight={0}>
          <MessageList messages={messages} model={currentModel} expandTools={expandTools} height={listBasis} />
        </Box>
        <Box flexShrink={0}>
          <Divider />
        </Box>
        {/* : the agent's current plan stays visible above the
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
            notify={printSystemMessage}
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
