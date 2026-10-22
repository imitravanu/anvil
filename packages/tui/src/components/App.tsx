import { getErrorMessage } from "@anvil/core";
import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { Box, Text, useApp, useStdout } from "ink";
import {
  AgentSession,
  contextBreakdown,
  CONTEXT_WARN_THRESHOLD,
  createProviders,
  refreshCustomProviderModels,
  resolveProviderCredentials,
  loadSession,
  loadCustomProviders,
  loadSettings,
  saveSettings,
  getModelsForProvider,
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
import { useFocusZone } from "../hooks/useFocusZone.js";
import { InputAvailabilityContext, useInput, useWheel } from "../hooks/useUIInput.js";
import { usePermissionBroker } from "../hooks/usePermissionBroker.js";
import { useThemeManager } from "../hooks/useThemeManager.js";
import { useSessionCommands } from "../hooks/useSessionCommands.js";
import { ThemeContext } from "../theme/theme.js";
import { PROVIDER_LABELS, refreshCustomProviderLabels } from "../util/labels.js";
import { formatPricingTag, modelInfo } from "../util/format.js";
import { formatRewindResult } from "../util/rewind.js";
import { Header } from "./Header.js";
import { InputBar } from "./InputBar.js";
import { MessageList } from "./MessageList.js";
import { TranscriptBoundary } from "./TranscriptBoundary.js";
import { ModelPicker } from "./ModelPicker.js";
import { PermissionPrompt } from "./PermissionPrompt.js";
import { FirstRunSetup } from "./FirstRunSetup.js";
import { MissionDeck } from "./MissionDeck.js";
import { DiffModal } from "./DiffModal.js";
import { RewindModal } from "./RewindModal.js";
import { SessionPicker } from "./SessionPicker.js";
import { ThemePicker } from "./ThemePicker.js";
import { HelpOverlay } from "./HelpOverlay.js";
import { StatusBar } from "./StatusBar.js";
import { QueuePicker } from "./QueuePicker.js";
import { TextDetail } from "./TextDetail.js";
import { SelectableRegion } from "./SelectableRegion.js";
import { sanitizeTerminalText } from "../util/sanitize.js";
import { transcriptDetails } from "../util/transcriptDetails.js";

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
  const { exit } = useApp();
  const [session, setSession] = useState(initialSession);
  const [providers, setProviders] = useState(() => {
    refreshCustomProviderLabels(initialProviders);
    return initialProviders;
  });
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
    submitMessage,
    launchGoal,
    cancel,
    printSystemMessage,
    clearMessages,
    replaceMessages,
    sentHistory,
    queued,
    queueEntries,
    queueHeld,
    removeQueued,
    resumeQueue,
    addPendingImage,
    pendingImagePaths,
    removePendingImage,
  } = useAgentController(session, {
    // Persist after every settled turn — including queued ones that drain
    // inside the controller, after handleSubmit has already returned.
    onTurnSettled: () => persistRef.current(),
  });
  const persistRef = useRef<() => void>(() => undefined);

  // Phase 28.9: completed user turns — resumed sessions seed this from their
  // history, fresh ones count from zero. System/assistant rows never count.
  const turnCount = messages.filter((m) => m.role === "user").length;

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
  const tooSmall = rows < 12 || (stdout?.columns ?? 80) < 40;
  const contextEstimate = useMemo(() => ({
    tokens: contextBreakdown(session.getHistory(), session.contextWindow, CONTEXT_WARN_THRESHOLD, session.tokenCalibration).totalTokens,
    limit: session.contextWindow,
  }), [session, currentModel, usage.inputTokens, isBusy]);
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
  const [connecting, setConnecting] = useState(false);
  const connectAbort = useRef<AbortController | null>(null);
  useEffect(() => () => connectAbort.current?.abort(), []);
  const [isThemePickerOpen, setIsThemePickerOpen] = useState(false);
  // /help and `?` — reference overlay (keys + every registered command).
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  const [isDiffOpen, setIsDiffOpen] = useState(false);
  const [branchDiff, setBranchDiff] = useState<{ branch: string; diff: string } | null>(null);
  const [isRewindOpen, setIsRewindOpen] = useState(false);
  const [isQueueOpen, setIsQueueOpen] = useState(false);
  const [isAttachmentsOpen, setIsAttachmentsOpen] = useState(false);
  const [detail, setDetail] = useState<{ title: string; text: string } | null>(null);
  // full tool-output display, toggled by /expand. Session-scoped,
  // never persisted — a resumed session starts compact.
  const [expandTools, setExpandTools] = useState(false);
  // Transcript scroll pin: newest messages held back (0 = follow live).
  const [transcriptPinned, setTranscriptPinned] = useState(0);
  const [selectionNotice, setSelectionNotice] = useState<string | null>(null);
  const transcriptMaximum = useRef(0);

  const { themeName, resolveTheme, applyTheme, previewTheme } = useThemeManager({ initialTheme, printSystemMessage });
  // Theme active before the picker started previewing — previews mutate
  // themeName, so Esc-restore needs a value captured at open time.
  const themeBeforePicker = useRef(initialTheme);
  // 28.8: App-level readable notices use the text tier, never decoration dim.
  const theme = resolveTheme(themeName);
  useEffect(() => {
    if (!isThemePickerOpen) themeBeforePicker.current = themeName;
  }, [isThemePickerOpen, themeName]);

  // Overlays own input while open, so the underlying transcript stays put.
  const overlaysOpen =
    pendingPermission !== null ||
    isDiffOpen ||
    isRewindOpen ||
    isModelPickerOpen ||
    isSessionPickerOpen ||
    isThemePickerOpen ||
    isHelpOpen ||
    isQueueOpen ||
    isAttachmentsOpen ||
    detail !== null ||
    isConnectOpen;
  // 23.9 focus coordinator: Tab toggles input↔transcript (slash-fill and
  // overlays keep their Tab), Esc returns to input. The transcript zone lets
  // Up/Down scroll rows; the input keeps them for history recall.
  const { zone: focusZone, onTab, onEscape, onOverlaysChanged } = useFocusZone();
  const [slashMenuOpen, setSlashMenuOpen] = useState(false);
  useWheel(delta => {
    setTranscriptPinned(previous => Math.max(0, Math.min(transcriptMaximum.current, previous + delta)));
  }, { isActive: !tooSmall && !overlaysOpen && !slashMenuOpen });
  useEffect(() => {
    onOverlaysChanged(overlaysOpen);
  }, [overlaysOpen, onOverlaysChanged]);
  useInput((input, key) => {
    if (key.ctrl && (input === "c" || input === "\x03")) {
      if (isBusy) cancel(); else exit();
      return;
    }
    if (tooSmall) return;
    if (connecting && key.escape) {
      connectAbort.current?.abort(); setConnecting(false); setIsConnectOpen(false); return;
    }
    if (overlaysOpen) return;
    if (key.ctrl && input === "q") { setIsQueueOpen(true); return; }
    if (key.ctrl && input === "b") { setIsAttachmentsOpen(true); return; }
    if (key.ctrl && input === "p") {
      setDetail({ title: "Plan", text: goal ? `${goal.title}\n${goal.milestones.map(m => `${m.status}: ${m.title}${m.detail ? ` — ${m.detail}` : ""}`).join("\n")}` : plan ?? "No plan recorded." }); return;
    }
    if (key.ctrl && input === "o") {
      setDetail({ title: "Transcript details · visible text and retained tool history", text: transcriptDetails(messages, session.getHistory()) }); return;
    }
    if (key.tab) {
      onTab(overlaysOpen, slashMenuOpen);
      return;
    }
    if (key.escape && focusZone === "transcript") {
      onEscape();
      return;
    }
    if (key.pageUp) {
      // Clamp at the increment (2026-10-10): the display clamp silently
      // absorbed state that grew past the ceiling, so held-PgUp surplus made
      // later PgDn presses invisible no-ops — scroll read as dead.
      setTranscriptPinned(prev => Math.min(transcriptMaximum.current, prev + Math.max(1, rows - 8)));
      return;
    }
    if (key.pageDown) {
      setTranscriptPinned(prev => Math.max(0, prev - Math.max(1, rows - 8)));
      return;
    }
    if (focusZone === "transcript") {
      if (key.home) { setTranscriptPinned(transcriptMaximum.current); return; }
      if (key.end) { setTranscriptPinned(0); return; }
      if (key.upArrow) {
        setTranscriptPinned(prev => Math.min(transcriptMaximum.current, prev + 1));
        return;
      }
      if (key.downArrow) {
        setTranscriptPinned((prev) => Math.max(0, prev - 1));
      }
    }
  });
  // Clamp the pin when the transcript shrinks (clear/resume/switch).
  useEffect(() => { setTranscriptPinned(0); transcriptMaximum.current = 0; }, [session]);

  const { handleSubmit, resumeFromStored, persist, mruCommands } = useSessionCommands({
    session,
    providers,
    activeProviderId,
    currentModel,
    sessionOptions,
    broker,
    mcp,
    isBusy,
    hasQueuedMessages: queued.length > 0,
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
    setIsHelpOpen,
    setExpandTools,
    expandTools,
    setIsDiffOpen,
    setBranchDiff,
    setIsRewindOpen,
    setGoal,
    send: async text => submitMessage(text),
    launchGoal,
    addPendingImage,
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
    if (queueHeld) printSystemMessage("Queued messages remain held. Use Ctrl+Q to review and resume them.");
    try {
      saveSettings({
        ...loadSettings(),
        defaultProviderId: provider.id,
        defaultModel: modelInfo.id,
      });
    } catch {
      // intentional: settings persistence is best-effort — the model switch is
      // already applied in memory, and a failed write must not break the UI.
    }
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
  const handleConnectDone = async (providerId: ProviderId) => {
    connectAbort.current?.abort();
    const controller = new AbortController();
    connectAbort.current = controller;
    setConnecting(true);
    try {
      const discovery = await refreshCustomProviderModels(loadCustomProviders().filter(config => config.id === providerId), { signal: controller.signal });
      if (controller.signal.aborted) return;
      for (const result of discovery) if (result.error) printSystemMessage(result.error);
      const refreshed = createProviders(resolveProviderCredentials());
      refreshCustomProviderLabels(refreshed);
      setProviders(refreshed);
      setIsConnectOpen(false);
      const label = PROVIDER_LABELS[providerId] ?? providerId;
      if (!refreshed[providerId]?.isConfigured()) {
        printSystemMessage(`${label} saved. Set its configured environment variables and reconnect before using it.`);
        return;
      }
      if (providerId === activeProviderId) {
        const models = getModelsForProvider(providerId);
        const nextModel = providerId.startsWith("custom:") && !models.some(model => model.id === currentModel)
          ? models[0]?.id ?? currentModel : currentModel;
        session.switchModel(refreshed[providerId], nextModel);
        setCurrentModel(nextModel);
        printSystemMessage(`✓ ${label} reconnected with the new key.`);
      } else {
        printSystemMessage(`✓ ${label} connected. Use /model to switch to it.`);
      }
      if (queueHeld) printSystemMessage("Queued messages remain held. Use Ctrl+Q to review and resume them.");
    } catch (err) {
      if (controller.signal.aborted) return;
      // A turn may have started if setup was dismissed during discovery.
      printSystemMessage(`Provider saved, but reconnect could not be applied: ${getErrorMessage(err)}`);
    } finally {
      if (connectAbort.current === controller) setConnecting(false);
    }
  };

  return (
    <ThemeContext.Provider value={resolveTheme(themeName)}>
      <InputAvailabilityContext.Provider value={!tooSmall}>
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
        height={Math.max(1, rows - 1)}
        width={stdout?.columns ?? 80}
        overflow="hidden"
      >
        {tooSmall && <Text color={theme.colors.textPrimary}>Resize to 40×12 or larger. Ctrl+C {isBusy ? "cancels" : "exits"}.</Text>}
        <Box display={tooSmall ? "none" : "flex"} flexDirection="column" flexGrow={1} minHeight={0}>
        {/* Only the transcript shrinks; controls retain their measured rows. */}
        <Header
          minimal
          model={currentModel}
          providerId={activeProviderId}
          isBusy={isBusy}
          context={situationalContext}
          sessionTitle={session.title}
          turnCount={turnCount}
        />
        <Box display={overlaysOpen || slashMenuOpen ? "none" : "flex"} flexDirection="column" flexGrow={1} flexShrink={1} minHeight={0} overflow="hidden" marginTop={1}>
          <TranscriptBoundary>
            <SelectableRegion enabled={!overlaysOpen && !slashMenuOpen && !tooSmall} resetKey={session.id} onNotice={setSelectionNotice}>
            <MessageList rowScroll messages={messages} model={currentModel} providerId={activeProviderId} expandTools={expandTools} pinnedBack={transcriptPinned} onBounds={(maximum, anchoredOffset) => {
              transcriptMaximum.current = maximum;
              setTranscriptPinned(anchoredOffset);
            }} />
            </SelectableRegion>
          </TranscriptBoundary>
        </Box>
        {/* Mission Deck: autonomous goal progression and persistent plan HUD */}
        {!overlaysOpen && <MissionDeck compact goal={goal} plan={plan} isBusy={isBusy} />}
        {queued.length > 0 && !overlaysOpen && (
          <Box flexShrink={0} paddingX={2}>
            <Text color={theme.colors.textSecondary}>
              {queued.length} message{queued.length === 1 ? "" : "s"} {queueHeld ? "held" : "queued"} · Ctrl+Q review
            </Text>
          </Box>
        )}
        {pendingImagePaths.length > 0 && !overlaysOpen && <Text color={theme.colors.textSecondary} wrap="truncate-end">{pendingImagePaths.length} image(s) staged · Ctrl+B inspect/remove{modelInfo(currentModel, activeProviderId)?.supportsVision === false ? " · model lacks vision" : modelInfo(currentModel, activeProviderId)?.supportsVision === undefined ? " · vision capability unknown" : ""}</Text>}
        {pendingImagePaths.length > 0 && !overlaysOpen && modelInfo(currentModel, activeProviderId)?.supportsVision !== true && <Text color={theme.colors.warning}>{modelInfo(currentModel, activeProviderId)?.supportsVision === false ? "This model does not support images. Switch models or remove the attachments." : "Vision support is unknown for this model."}</Text>}
        {/* Keep the editor mounted to retain its draft/cursor; deactivate its input under overlays. */}
        {pendingPermission ? (
          <PermissionPrompt
            request={pendingPermission}
            broker={broker}
            knownServerIds={mcp?.list().map((conn) => conn.id) ?? []}
          />
        ) : isAttachmentsOpen ? (
          <QueuePicker title="Staged images" items={pendingImagePaths.map(path => ({ id: path, text: path }))} held={false} onRemove={removePendingImage} onResume={() => {}} onClose={() => setIsAttachmentsOpen(false)} />
        ) : detail ? (
          <TextDetail title={detail.title} text={sanitizeTerminalText(detail.text)} onClose={() => setDetail(null)} />
        ) : isQueueOpen ? (
          <QueuePicker items={queueEntries} held={queueHeld} onRemove={removeQueued} onResume={() => { void resumeQueue(); setIsQueueOpen(false); }} onClose={() => setIsQueueOpen(false)} />
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
            minimal
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
            minimal
            onConnect={() => { setIsModelPickerOpen(false); setIsConnectOpen(true); }}
            providers={providers}
            currentModelId={currentModel}
            currentProviderId={activeProviderId}
            onSelect={handleModelSelect}
            onClose={() => setIsModelPickerOpen(false)}
          />
        ) : isSessionPickerOpen ? (
          <SessionPicker
            minimal
            onSelect={handleSessionPick}
            onClose={() => setIsSessionPickerOpen(false)}
          />
        ) : isThemePickerOpen ? (
          <ThemePicker
            minimal
            currentThemeName={themeBeforePicker.current}
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
          connecting ? <Box flexDirection="column" paddingX={1}>
            <Text color={theme.colors.textPrimary}>Settings saved. Discovering available models…</Text>
            <Text color={theme.colors.textSecondary}>Esc closes and cancels discovery. Model inference has not been tested.</Text>
          </Box> : <FirstRunSetup
            handleCtrlC={false}
            title="Connect a provider or add your own endpoint."
            activeProviderId={activeProviderId}
            onRemoved={() => {
              const refreshed = createProviders(resolveProviderCredentials());
              refreshCustomProviderLabels(refreshed);
              setProviders(refreshed);
              printSystemMessage("Custom provider removed. Saved conversations are retained.");
            }}
            onDone={handleConnectDone}
            onCancel={() => setIsConnectOpen(false)}
          />
        ) : isHelpOpen ? (
          <HelpOverlay minimal onClose={() => setIsHelpOpen(false)} />
        ) : null}
          <InputBar
            sessionId={session.id}
            hidden={overlaysOpen}
            handleCtrlC={false}
            isBusy={isBusy}
            hasFocus={focusZone === "input"}
            onSlashMenuChange={setSlashMenuOpen}
            onSubmit={async (text, literal) => {
              // New turn returns to live follow so the reply is visible.
              const accepted = await handleSubmit(text, literal);
              if (accepted !== false) setTranscriptPinned(0);
              return accepted;
            }}
            onCancel={cancel}
            sentHistory={sentHistory}
            mruCommands={mruCommands}
            onOpenHelp={() => setIsHelpOpen(true)}
          />
        {!overlaysOpen && <StatusBar
          minimal
          selectionNotice={selectionNotice}
          waiting={pendingPermission !== null}
          contextEstimate={contextEstimate}
          model={currentModel}
          providerId={activeProviderId}
          isBusy={isBusy}
          usage={usage}
          checkpointCount={session.getCheckpoints().length}
          testStatus={testStatus}
          tokenHistory={tokenHistory}
        />}
        </Box>
      </Box>
      </InputAvailabilityContext.Provider>
    </ThemeContext.Provider>
  );
}
