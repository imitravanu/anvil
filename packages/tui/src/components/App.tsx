import { getErrorMessage } from "@anvil/core";
import { useEffect, useReducer, useRef, useState } from "react";
import { Box, Text, useInput, useStdout } from "ink";
import {
  AgentSession,
  createProviders,
  loadCredentials,
  loadSession,
  analyzeWorkspace,
  type AgentOptions,
  type McpServerConnection,
  type ModelInfo,
  type ModelProvider,
  type ProviderId,
  type SituationalContext,
} from "@anvil/core";
import type { TuiPermissionBroker } from "../permission/TuiPermissionBroker.js";
import { useAgentController } from "../hooks/useAgentController.js";
import { usePermissionBroker } from "../hooks/usePermissionBroker.js";
import { useThemeManager } from "../hooks/useThemeManager.js";
import { useSessionCommands } from "../hooks/useSessionCommands.js";
import { ThemeContext, useTheme } from "../theme/theme.js";
import { PROVIDER_LABELS } from "../util/labels.js";
import { formatPricingTag } from "../util/format.js";
import { formatRewindResult } from "../util/rewind.js";
import { Header } from "./Header.js";
import { InputBar } from "./InputBar.js";
import { MessageList } from "./MessageList.js";
import { ModelPicker } from "./ModelPicker.js";
import { PermissionPrompt } from "./PermissionPrompt.js";
import { FirstRunSetup } from "./FirstRunSetup.js";
import { MissionDeck } from "./MissionDeck.js";
import { DiffModal } from "./DiffModal.js";
import { RewindModal } from "./RewindModal.js";
import { SessionPicker } from "./SessionPicker.js";
import { ThemePicker } from "./ThemePicker.js";
import { StatusBar } from "./StatusBar.js";
import { TRANSCRIPT_SCROLL_PAGE } from "../util/displayLimits.js";

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
    tokenHistory,
    plan,
    goal,
    setGoal,
    testStatus,
    send,
    launchGoal,
    cancel,
    printSystemMessage,
    clearMessages,
    replaceMessages,
    sentHistory,
    queued,
    addPendingImage,
    recordSentMessage,
  } = useAgentController(session, {
    // Persist after every settled turn — including queued ones that drain
    // inside the controller, after handleSubmit has already returned.
    onTurnSettled: () => persistRef.current(),
  });
  const persistRef = useRef<() => void>(() => undefined);

  const [situationalContext, setSituationalContext] = useState<SituationalContext | undefined>();
  useEffect(() => {
    let active = true;
    void analyzeWorkspace(session.projectRoot).then((ctx) => {
      if (active) setSituationalContext(ctx);
    });
    return () => {
      active = false;
    };
  }, [session.projectRoot]);

  useEffect(() => {
    if (mcp?.notices && mcp.notices.length > 0) {
      for (const notice of mcp.notices) {
        printSystemMessage(`⚠ ${notice}`);
      }
    }
  }, []);

  const { stdout } = useStdout();
  const rows = stdout?.rows ?? 24;
  // Ink does not re-render on terminal resize by itself, and every zone here
  // reads rows/columns during render — so without this the frame stays
  // frozen at whatever size the terminal was at boot (fullscreening left the
  // app stuck in a small corner). The TTY emits "resize" on SIGWINCH.
  const [, resizeTick] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    if (!stdout) return;
    stdout.on("resize", resizeTick);
    return () => {
      stdout.off("resize", resizeTick);
    };
  }, [stdout]);
  // No explicit listBasis: the transcript region is flex-sized (flexGrow=1,
  // minHeight=0, overflow hidden) and Yoga owns the row budget. The previous
  // rows-9 arithmetic fought every overlay (slash menu, permission prompt,
  // DiffModal, MissionDeck) and stacked their rows onto the transcript.

  const pendingPermission = usePermissionBroker(broker);
  const [isModelPickerOpen, setIsModelPickerOpen] = useState(false);
  const [isSessionPickerOpen, setIsSessionPickerOpen] = useState(false);
  const [isConnectOpen, setIsConnectOpen] = useState(false);
  const [isThemePickerOpen, setIsThemePickerOpen] = useState(false);
  const [isDiffOpen, setIsDiffOpen] = useState(false);
  const [branchDiff, setBranchDiff] = useState<{ branch: string; diff: string } | null>(null);
  const [isRewindOpen, setIsRewindOpen] = useState(false);
  // full tool-output display, toggled by /expand. Session-scoped,
  // never persisted — a resumed session starts compact.
  const [expandTools, setExpandTools] = useState(false);
  // Transcript scroll pin: newest messages held back (0 = follow live).
  const [transcriptPinned, setTranscriptPinned] = useState(0);

  const { themeName, resolveTheme, applyTheme, previewTheme } = useThemeManager({ initialTheme, printSystemMessage });
  // Theme active before the picker started previewing — previews mutate
  // themeName, so Esc-restore needs a value captured at open time.
  const themeBeforePicker = useRef(initialTheme);
  useEffect(() => {
    if (!isThemePickerOpen) themeBeforePicker.current = themeName;
  }, [isThemePickerOpen, themeName]);

  // PgUp/PgDn transcript scroll (keyboard-first; trackpads need inline mode).
  // Overlays own their keys while open, so the transcript stays put then.
  const overlaysOpen =
    pendingPermission !== null ||
    isDiffOpen ||
    isRewindOpen ||
    isModelPickerOpen ||
    isSessionPickerOpen ||
    isThemePickerOpen ||
    isConnectOpen;
  useInput((_input, key) => {
    if (overlaysOpen) return;
    if (key.pageUp) {
      setTranscriptPinned((prev) => prev + TRANSCRIPT_SCROLL_PAGE);
      return;
    }
    if (key.pageDown) {
      setTranscriptPinned((prev) => Math.max(0, prev - TRANSCRIPT_SCROLL_PAGE));
    }
  });
  // Clamp the pin when the transcript shrinks (clear/resume/switch).
  useEffect(() => {
    setTranscriptPinned((prev) => Math.max(0, Math.min(prev, Math.max(0, messages.length - 1))));
  }, [messages.length]);

  const { handleSubmit, resumeFromStored, persist, mruCommands } = useSessionCommands({
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
    expandTools,
    setIsDiffOpen,
    setBranchDiff,
    setIsRewindOpen,
    setGoal,
    send,
    launchGoal,
    addPendingImage,
    recordSentMessage,
  });
  persistRef.current = persist;




  const handleModelSelect = (provider: ModelProvider, modelInfo: ModelInfo) => {
    const result = session.switchModel(provider, modelInfo.id);
    const pricingTag = formatPricingTag(modelInfo.isFree);
    if (result.historyCleared) {
      // Fresh conversation context — stale "always allow" grants die with it,
      // and the transcript resets so it never shows turns the new session
      // doesn't have (which read as the model "forgetting").
      broker.clearSessionApprovals();
      clearMessages();
      printSystemMessage(
        `Switched to ${provider.id}/${modelInfo.id}${pricingTag} — conversation history was cleared (different provider; permission grants reset).`
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
      {/* The frame is one row SHORTER than the terminal, deliberately. Ink
          (build/ink.js) wipes the entire terminal — screen, scrollback, home —
          whenever rendered height >= terminal rows; a frame exactly `rows`
          tall trips that on EVERY re-render (each spinner tick), and in a
          native terminal (no tmux) the wipes desync the pane: chat text
          vanishes, redraws land on wrong rows (reproduced at 236x46 with 326
          wipes in one session). One spare row keeps rendered height < rows
          forever, so Ink always uses its stable in-place diff path. */}
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor={resolveTheme(themeName).colors.border}
        height={Math.max(9, rows - 1)}
        width={stdout?.columns ?? 80}
        overflow="hidden"
      >
        {/* Every fixed-height zone keeps its rows: each component's root Box
            is flexShrink={0} (see components) and the bare Divider text is
            wrapped here. When content exceeds the frame (long transcripts,
            tall overlays), the message list is the ONLY element allowed to
            shrink — Ink's CSS-style default flex-shrink:1 otherwise compresses
            everything at once, which is what made turns and chrome overwrite
            each other's rows. */}
        <Header model={currentModel} isBusy={isBusy} context={situationalContext} />
        <Box flexShrink={0}>
          <Divider />
        </Box>
        <Box flexDirection="column" flexGrow={1} flexShrink={1} minHeight={0}>
          <MessageList messages={messages} model={currentModel} expandTools={expandTools} pinnedBack={transcriptPinned} />
        </Box>
        <Box flexShrink={0}>
          <Divider />
        </Box>
        {/* Mission Deck: autonomous goal progression and persistent plan HUD */}
        <MissionDeck goal={goal} plan={plan} isBusy={isBusy} />
        {queued.length > 0 && (
          <Box flexShrink={0} paddingX={2}>
            <Text dimColor>
              ⏳ {queued.length} message{queued.length === 1 ? "" : "s"} queued — sends when the current turn finishes
            </Text>
          </Box>
        )}
        {/* Overlays take over keyboard input — InputBar is not rendered while one is open,
            so keystrokes can never leak into it. */}
        {pendingPermission ? (
          <PermissionPrompt request={pendingPermission} broker={broker} />
        ) : isDiffOpen ? (
          <DiffModal
            session={session}
            branchDiff={branchDiff}
            onClose={() => {
              setIsDiffOpen(false);
              setBranchDiff(null);
            }}
          />
        ) : isRewindOpen ? (
          <RewindModal
            session={session}
            onSelect={(id) => {
              setIsRewindOpen(false);
              void session
                .rewind(id)
                .then((result) => {
                  printSystemMessage(formatRewindResult(result));
                  persistRef.current();
                })
                .catch((err: unknown) => {
                  printSystemMessage(
                    `Rewind failed: ${getErrorMessage(err)}`
                  );
                });
            }}
            onClose={() => setIsRewindOpen(false)}
          />
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
        ) : isThemePickerOpen ? (
          <ThemePicker
            onPreview={previewTheme}
            onApply={(name) => {
              applyTheme(name);
              setIsThemePickerOpen(false);
            }}
            onCancel={() => {
              previewTheme(themeBeforePicker.current);
              setIsThemePickerOpen(false);
            }}
          />
        ) : isConnectOpen ? (
          <FirstRunSetup
            title="Connect a provider — pick one, paste its API key, done."
            onDone={handleConnectDone}
            onCancel={() => setIsConnectOpen(false)}
          />
        ) : (
          <InputBar
            isBusy={isBusy}
            onSubmit={(text) => {
              // New turn returns to live follow so the reply is visible.
              setTranscriptPinned(0);
              void handleSubmit(text);
            }}
            onCancel={cancel}
            sentHistory={sentHistory}
            mruCommands={mruCommands}
          />
        )}
        <StatusBar
          model={currentModel}
          isBusy={isBusy}
          usage={usage}
          checkpointCount={session.getCheckpoints().length}
          testStatus={testStatus}
          tokenHistory={tokenHistory}
        />
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
