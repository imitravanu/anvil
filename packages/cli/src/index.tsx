#!/usr/bin/env node
import { getErrorMessage } from "@anvil/core";
import React from "react";
import { render } from "ink";
import {
  CORE_VERSION,
  STDIN_CONTEXT_PEEK_MS,
  MCP_CONNECT_TIMEOUT_MS,
  McpServerConnection,
  TOOL_DEFINITIONS,
  connectAllMcpServers,
  createMcpExecutor,
  createProviders,
  describeMcpInput,
  dropCollidingMcpTools,
  hasAnyConfiguredProvider,
  AgentSession,
  killAllMcpServers,
  loadCredentials,
  resolveProviderCredentials,
  loadSettings,
  saveSettings,
  loadModelsCacheV2,
  collectModelsFromCache,
  registerExternalExecutor,
  registerModels,
  loadPlugins,
  registerPluginExecutors,
  pluginSystemPrompts,
  syncFreeModels,
  createOpenRouterFreeSource,
  createOrcarouterFreeSource,
  toToolDefinitions,
  MCP_TOOL_PREFIX,
  ProviderSelectionError,
  UnknownProviderError,
  resolveProviderSelection,
  buildAnvilAgentProfile,
  getLatestCertificationDate,
  type ModelProvider,
  type ProviderId,
  type ToolDefinition,
  getModelsForProvider,
  loadCustomProviders,
  refreshCustomProviderModels,
  validateCustomProvider,
  FALLBACK_CONTEXT_WINDOW,
  type CustomProviderConfig,
} from "@anvil/core";

import { App, FirstRunSetup, TuiPermissionBroker, detectTerminalTheme, isThemeName, loadCustomThemes } from "@anvil/tui";
import { runHeadless, readStdin } from "./headless.js";
import { runGoalHeadless } from "./goalRunner.js";
import { runNativeGate, runNativeGateWatch, isSignalClaimed } from "./gate.js";
import { runGuardedInit } from "./initGuarded.js";
import { runHealth } from "./health.js";
import { enterAltScreen, exitAltScreen } from "./altScreen.js";
import { interactiveRenderOptions } from "./interactiveRenderOptions.js";
import { parseFlags, resolveInvocation } from "./args.js";
import { buildHelpText } from "./help.js";
import { runProviderCommand } from "./providerCommand.js";

// Detached MCP server children would outlive Anvil — SIGKILL them on exit.
// `exit` alone misses real signals (kill, terminal close), so hook those too.
// NOTE: process-group kill is Unix-only; on Windows each child is killed
// individually as a best effort (see transport fallbacks).
// DW-4.7: the alt screen is restored on every exit path so the terminal is
// never stranded (exitAltScreen is idempotent and sync-safe).
process.on("exit", () => {
  exitAltScreen();
  killAllMcpServers();
});
for (const [sig, code] of [["SIGTERM", 143], ["SIGHUP", 129]] as const) {
  process.on(sig, () => {
    // G8: defer to a runner that has explicitly CLAIMED this signal (e.g.
    // `anvil gate --watch`) so it can record its final state and exit 0.
    // Ownership is asserted, not inferred from listener counts — a foreign
    // listener must never stop terminal restore / MCP cleanup.
    if (isSignalClaimed(sig)) return;
    try {
      exitAltScreen();
      killAllMcpServers();
    } finally {
      process.exit(code);
    }
  });
}

// For SIGINT: If an active runner (headless session or TUI) has attached a handler,
// let it perform graceful cancellation. Only exit immediately if no other listener is attached.
process.on("SIGINT", () => {
  if (process.listenerCount("SIGINT") <= 1) {
    try {
      exitAltScreen();
      killAllMcpServers();
    } finally {
      process.exit(130);
    }
  }
});

const VERSION = CORE_VERSION;

const HELP = buildHelpText(VERSION);

// --- Startup crash guard: never leave the terminal in a broken raw-mode state. ---
let appInstance: { unmount: () => void } | null = null;

function crashDetail(err: unknown): string {
  if (err instanceof Error) {
    return err.stack ?? err.message;
  }
  return getErrorMessage(err);
}

function crash(err: unknown): never {
  try {
    appInstance?.unmount();
  } catch {
    // intentional: unmount is best-effort during a fatal crash — never throw inside crash().
  }
  // Restore the main screen first so the crash detail is visible, not lost
  // in a discarded alt buffer.
  exitAltScreen();
  try {
    // Ink owns raw mode while mounted; make sure a fatal crash can't strand it.
    (process.stdin as NodeJS.ReadStream).setRawMode?.(false);
  } catch {
    // intentional: not a TTY — nothing to restore.
  }
  process.stderr.write(
    "Anvil hit an unexpected error:\n" + crashDetail(err) + "\n"
  );
  process.exit(1);
}
process.on("uncaughtException", crash);
// An aborted stream can reject after its consumer has stopped listening. Report
// that diagnostic, but do not forcibly tear down Ink (and leave raw mode broken).
process.on("unhandledRejection", (reason) => {
  process.stderr.write(
    "Anvil observed an unhandled promise rejection:\n" + crashDetail(reason) + "\n"
  );
  process.exitCode = 1;
});

// ---------------------------------------------------------------------------
// Shared boot context. chat / headless / goal used to repeat this block
// (~60 lines each, drifting: headless/goal swallowed MCP failures silently).
// ---------------------------------------------------------------------------

interface BootContext {
  creds: ReturnType<typeof loadCredentials>;
  settings: ReturnType<typeof loadSettings>;
  providers: Record<ProviderId, ModelProvider>;
  provider: ModelProvider;
  providerId: ProviderId;
  model: string;
  mcpConns: Map<string, McpServerConnection>;
  mcpNotices: string[];
  mcpDefs: ToolDefinition[];
  /**
   * Full wired session tool list: built-ins + plugin tools (Phase 25.4) +
   * MCP. Undefined only when plugins AND MCP are both empty, so the session
   * falls back to its built-in defaults (legacy behavior preserved).
   */
  sessionTools?: ToolDefinition[];
  /**
   * Phase 25.4 wired into the product: enabled plugin tools (executors
   * registered) + their system-prompt additions, loaded ONCE per boot here so
   * chat / headless / goal cannot drift. Empty arrays = no usable plugins.
   */
  pluginDefs: ToolDefinition[];
  pluginPrompts: string[];
}

function restoreCachedModels(): void {
  // Restore the persisted free-model snapshot (any source) before the model
  // picker needs it. Staleness is surfaced by the picker, not hidden.
  const cached = loadModelsCacheV2();
  const cachedModels = collectModelsFromCache(cached);
  if (cachedModels.length > 0) {
    registerModels(cachedModels);
  }
}

function resolveSelectionOrExit(
  flags: Record<string, string>,
  creds: ReturnType<typeof loadCredentials>,
  settings: ReturnType<typeof loadSettings>,
  customProviders?: CustomProviderConfig[],
  customApiKeys?: Partial<Record<`custom:${string}`, string>>,
): { providerId: ProviderId; model: string } {
  let selection;
  try {
    selection = resolveProviderSelection({
      flagProvider: flags.provider,
      flagModel: flags.model,
      envProvider: process.env.ANVIL_PROVIDER,
      envModel: process.env.ANVIL_MODEL,
      settings,
      creds,
      customProviders,
      customApiKeys,
    });
  } catch (err) {
    if (err instanceof ProviderSelectionError) {
      console.error(err.message);
      process.exit(1);
    }
    throw err;
  }
  if (!selection) {
    console.error("No provider is configured. Run `anvil config` to add an API key.");
    process.exit(1);
  }
  return selection;
}

async function connectMcpTools(
  conns: Map<string, McpServerConnection>,
  notices: string[]
): Promise<{ defs: ToolDefinition[]; connected: number; toolCount: number }> {
  // All MCP outcomes land in `notices` — nothing is swallowed (headless/goal
  // used to silently catch here, so a dead MCP server just vanished).
  const empty = { defs: [], connected: 0, toolCount: 0 };
  try {
    const mcp = await connectAllMcpServers(conns, { timeoutMs: MCP_CONNECT_TIMEOUT_MS });
    for (const problem of mcp.problems) notices.push(`MCP ${problem}`);
    if (mcp.connected === 0 && notices.length === 0) return empty;
    const allMcpDefs = [...conns.values()].flatMap((c) =>
      c.status === "ready" ? toToolDefinitions(c.id, c.tools) : []
    );
    const collision = dropCollidingMcpTools(
      TOOL_DEFINITIONS.map((d) => d.name),
      allMcpDefs
    );
    for (const d of collision.dropped) notices.push(`MCP dropped tool ${d.name} (name collision)`);
    registerExternalExecutor(
      MCP_TOOL_PREFIX,
      createMcpExecutor(() => conns),
      describeMcpInput
    );
    return { defs: collision.kept, connected: mcp.connected, toolCount: mcp.tools };
  } catch (err) {
    notices.push(`MCP connect failed: ${getErrorMessage(err)}`);
    return empty;
  }
}

async function resolveBootContext(
  flags: Record<string, string>,
  opts: { mode: "chat" | "headless" | "goal" }
): Promise<BootContext> {
  restoreCachedModels();
  const creds = resolveProviderCredentials();
  const settings = loadSettings();

  const envKeyName = flags["api-key-env"];
  if (envKeyName && (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(envKeyName) || !process.env[envKeyName]?.trim())) {
    throw new Error("--api-key-env requires a set, non-empty environment variable.");
  }
  const explicitKey = flags["api-key"] ?? (envKeyName ? process.env[envKeyName] : undefined);
  if (explicitKey && !flags.provider && !flags["base-url"]) throw new Error("An API key override requires --provider or --base-url.");
  if (!flags["base-url"] && flags.protocol) throw new Error("--protocol requires --base-url.");
  if (!flags["base-url"] && explicitKey && flags.provider && !flags.provider.startsWith("custom:")) {
    const keyProp = `${flags.provider}ApiKey` as keyof typeof creds;
    creds[keyProp] = explicitKey;
  }

  // Ad-hoc --base-url provider injection
  let customConfigs = loadCustomProviders();
  const customApiKeys: Partial<Record<`custom:${string}`, string>> = {};
  if (explicitKey && flags.provider?.startsWith("custom:")) customApiKeys[flags.provider as `custom:${string}`] = explicitKey;
  if (flags["base-url"]) {
    const existing = customConfigs.find(config => config.id === flags.provider);
    if (flags.provider && !existing && !Object.hasOwn(creds, `${flags.provider}ApiKey`)) throw new UnknownProviderError(flags.provider);
    const adHocProviderId = existing?.id ?? "custom:adhoc";
    const inheritedKey = flags.provider ? (creds[`${flags.provider}ApiKey` as keyof typeof creds] as string | undefined) : undefined;
    const resolvedKey = explicitKey ?? inheritedKey;
    const adHocConfig = validateCustomProvider({
      ...existing,
      id: adHocProviderId,
      name: flags.provider || "Ad-hoc Provider",
      baseUrl: flags["base-url"],
      auth: resolvedKey ? "bearer" : existing?.auth ?? "none",
      ...(resolvedKey ? { apiKeyEnv: undefined } : {}),
      protocol: flags.protocol ?? existing?.protocol ?? (flags.provider === "anthropic" ? "anthropic" : "openai-chat"),
      ...(flags.model ? { models: [{ id: flags.model, contextWindow: FALLBACK_CONTEXT_WINDOW }] } : {}),
    });
    customConfigs = [...customConfigs.filter((c) => c.id !== adHocProviderId), adHocConfig];
    flags.provider = adHocProviderId;
    if (resolvedKey) customApiKeys[adHocProviderId] = resolvedKey;
  }

  const discovery = await refreshCustomProviderModels(customConfigs, { apiKeys: customApiKeys });
  for (const result of discovery) {
    if (result.error) console.error(`Custom model discovery: ${result.error}`);
  }
  const selection = resolveSelectionOrExit(flags, creds, settings, customConfigs, customApiKeys);
  const providers = createProviders(creds, customConfigs, customApiKeys);

  const provider = providers[selection.providerId];
  if (!provider.isConfigured(selection.model)) {
    console.error(
      `Provider "${selection.providerId}" is not configured. Check ~/.anvil/credentials.json.`
    );
    process.exit(1);
  }

  const raw = flags.raw === "1";
  const diagnostic = (text: string): void => {
    if (opts.mode === "chat" || !raw) process.stderr.write(`${text}\n`);
  };

  const mcpConns = new Map<string, McpServerConnection>();
  const mcpNotices: string[] = [];
  let mcpDefs: ToolDefinition[] = [];
  if (flags["no-mcp"]) {
    mcpNotices.push("MCP disabled by --no-mcp.");
  } else {
    const mcp = await connectMcpTools(mcpConns, mcpNotices);
    mcpDefs = mcp.defs;
    if (mcp.connected > 0) {
      diagnostic(`MCP: ${mcp.toolCount} tool(s) from ${mcp.connected} server(s).`);
    }
    for (const notice of mcpNotices) diagnostic(`⚠ ${notice}`);
  }

  return {
    creds,
    settings,
    providers,
    provider,
    providerId: selection.providerId,
    model: selection.model,
    mcpConns,
    mcpNotices,
    mcpDefs,
    // Phase 25.4 → product: load plugins once per boot, register their
    // executors (before any session exists), surface problems as boot
    // diagnostics. A broken plugin never blocks the run.
    ...(() => {
      const { plugins, problems } = loadPlugins();
      for (const p of problems) diagnostic(`⚠ plugin problem (${p.name}): ${p.error}`);
      // registerPluginExecutors registers the executors AND returns the batch
      // tool definitions (pluginToolDefinitions is the per-plugin variant).
      const pluginDefs = registerPluginExecutors(plugins);
      return {
        pluginDefs,
        pluginPrompts: pluginSystemPrompts(plugins),
        sessionTools:
          pluginDefs.length > 0 || mcpDefs.length > 0
            ? [...TOOL_DEFINITIONS, ...pluginDefs, ...mcpDefs]
            : undefined,
      };
    })(),
  };
}

async function bootChat(flags: Record<string, string>): Promise<void> {
  // DW-4.7: enter the alt screen before the first Ink paint (no-op when
  // piped, dumb, or opted out via ANVIL_NO_ALT_SCREEN=1).
  enterAltScreen();
  const ctx = await resolveBootContext(flags, { mode: "chat" });
  const { providers, provider, providerId, model, mcpConns, mcpNotices } = ctx;

  if (!flags["base-url"] && (flags.provider || flags.model)) {
    try {
      saveSettings({
        ...loadSettings(),
        defaultProviderId: providerId,
        defaultModel: model,
      });
    } catch {
      // intentional: settings persistence is best-effort — the selection is
      // already active in memory, and a failed write must not block boot.
    }
  }

  // one owner for free-model syncing — the coordinator. Single-flight
  // + TTL mean boot, picker, and /sync can never double-fetch or silently diverge.
  if (providers.openrouter?.isConfigured() || providers.orcarouter?.isConfigured()) {
    void syncFreeModels({
      sources: [createOpenRouterFreeSource(), createOrcarouterFreeSource()],
      apiKeyBySource: {
        openrouter: ctx.creds.openrouterApiKey,
        orcarouter: ctx.creds.orcarouterApiKey,
      },
    });
  }

  const broker = new TuiPermissionBroker();
  const projectRoot = process.cwd();
  // One owner for prompt + output budget + verify flag, shared with headless
  // and the eval lane so none of them can measure a different agent.
  // Plugin prompts ride the shared boot context (loaded once in
  // resolveBootContext); sessionTools already carries built-ins + plugins + MCP.
  const profile = buildAnvilAgentProfile(projectRoot, {
    pluginPrompts: ctx.pluginPrompts,
  });

  const session = new AgentSession(provider, {
    systemPrompt: profile.systemPrompt,
    model,
    maxTokens: profile.maxTokens,
    projectRoot,
    permissionBroker: broker,
    // Closed-loop verification is a core product behavior, not a goal-mode
    // extra: after mutations, the detected test runner gates the turn.
    autoVerify: profile.autoVerify,
    ...(ctx.sessionTools !== undefined ? { tools: ctx.sessionTools } : {}),
  });

  const rawTheme = ctx.settings.theme;
  const customThemeNames = loadCustomThemes().themes;
  // DW-4.4: with no configured theme, match the terminal background instead
  // of assuming dark. Detection is env-only (null → previous behavior).
  const detected = rawTheme === undefined ? detectTerminalTheme() : null;
  const initialTheme =
    (rawTheme !== undefined && (isThemeName(rawTheme) || rawTheme in customThemeNames))
      ? rawTheme
      : (detected ?? undefined);

  appInstance = render(
    <App
      session={session}
      broker={broker}
      providers={providers}
      providerId={providerId}
      model={model}
      initialTheme={initialTheme}
      sessionOptions={{
        systemPrompt: profile.systemPrompt,
        maxTokens: profile.maxTokens,
        projectRoot,
        autoVerify: profile.autoVerify,
        ...(ctx.sessionTools !== undefined ? { tools: ctx.sessionTools } : {}),
      }}
      mcp={{
        list: () => [...mcpConns.values()],
        notices: mcpNotices,
        reconnect: () => connectAllMcpServers(mcpConns, { timeoutMs: MCP_CONNECT_TIMEOUT_MS }),
      }}
    />,
    interactiveRenderOptions
  );
}

async function bootHeadless(prompt: string, flags: Record<string, string>): Promise<void> {
  const ctx = await resolveBootContext(flags, { mode: "headless" });
  const exitCode = await runHeadless({
    prompt,
    provider: ctx.provider,
    model: ctx.model,
    projectRoot: process.cwd(),
    autoApprove: flags.yes === "1",
    raw: flags.raw === "1",
    sessionTools: ctx.sessionTools,
    pluginPrompts: ctx.pluginPrompts,
  });
  process.exit(exitCode);
}

async function bootGoal(goal: string, flags: Record<string, string>): Promise<void> {
  const ctx = await resolveBootContext(flags, { mode: "goal" });
  const exitCode = await runGoalHeadless({
    goal,
    provider: ctx.provider,
    model: ctx.model,
    projectRoot: process.cwd(),
    autoApprove: flags.yes === "1",
    raw: flags.raw === "1",
    sessionTools: ctx.sessionTools,
  });
  process.exit(exitCode);
}

function runSetup(thenChat: boolean): void {
  // Interactive TUI requires a real terminal (raw-mode keyboard input).
  if (!process.stdin.isTTY) {
    console.error("Anvil needs an interactive terminal (stdin is not a TTY).");
    process.exit(1);
  }
  enterAltScreen();
  let instance: ReturnType<typeof render> | null = null;
  instance = render(
    <FirstRunSetup
      onDone={(chosenProviderId) => {
        const configuredProviders = createProviders(resolveProviderCredentials());
        const selectedModel = getModelsForProvider(chosenProviderId)[0]?.id;
        try {
          saveSettings({
            ...loadSettings(),
            defaultProviderId: chosenProviderId,
            ...(selectedModel ? { defaultModel: selectedModel } : {}),
          });
        } catch {
          // intentional: first-run persistence is best-effort; the chosen
          // provider is already in use for this session.
        }
        instance?.unmount();
        appInstance = null;
        if (!configuredProviders[chosenProviderId].isConfigured()) {
          exitAltScreen();
          process.stderr.write("Provider saved. Set its configured environment variables before starting Anvil.\n");
          return;
        }
        if (thenChat) void runFromFlags(parseFlags(process.argv.slice(2)));
        else exitAltScreen();
      }}
    />,
    interactiveRenderOptions
  );
  appInstance = instance;
}

/**
 * Default (no subcommand) path: a goal mission, a headless turn (from the
 * --prompt flag or piped stdin), or the interactive chat. Extracted so the
 * top-level dispatch stays a thin switch over the resolved invocation.
 */
async function runFromFlags(flags: Record<string, string>): Promise<void> {
  if (flags.goal && flags.goal.trim()) {
    await bootGoal(flags.goal.trim(), flags);
    return;
  }

  const hasPromptFlag = Boolean(flags.prompt && flags.prompt.trim());
  // G11 (AUDIT-2026-09-30): with an explicit --prompt, stdin is auxiliary
  // context — peek briefly rather than blocking up to STDIN_IDLE_TIMEOUT_MS on
  // a silent inherited pipe. Without --prompt stdin IS the prompt, so the full
  // idle window still applies (slow producers keep working there).
  const stdinText = await readStdin(
    hasPromptFlag ? STDIN_CONTEXT_PEEK_MS : undefined,
    undefined,
    undefined,
    flags.raw === "1"
  );
  const hasStdin = Boolean(stdinText && stdinText.trim());

  if (hasPromptFlag || hasStdin) {
    let finalPrompt = flags.prompt ?? "";
    if (hasStdin) {
      finalPrompt = finalPrompt
        ? `[Context from stdin]\n${stdinText.trim()}\n\n${finalPrompt}`
        : stdinText.trim();
    }
    await bootHeadless(finalPrompt, flags);
    return;
  }

  if (!process.stdin.isTTY) {
    console.error(
      "Anvil is running non-interactively (stdin is not a TTY).\n" +
        "Provide a prompt with --prompt <text> or pipe input via stdin."
    );
    process.exit(1);
  }
  void bootChat(flags);
}

// --- Argument dispatch, before any TUI rendering. The decision itself lives in
// args.ts (unit-tested); this switch is only the side-effect wiring. ---
const argv = process.argv.slice(2);
// --verbose applies to EVERY mode (chat/headless/goal/gate), so it is applied
// before the dispatch, not inside runFromFlags. The logger reads ANVIL_LOG
// lazily per call, so setting the env here gates all subsequent output.
if (argv.includes("--verbose")) {
  process.env.ANVIL_LOG = process.env.ANVIL_LOG ?? "info";
}
const preliminaryInvocation = resolveInvocation(argv, { hasConfiguredProvider: true });
const invocation = preliminaryInvocation.kind === "run"
  ? resolveInvocation(argv, { hasConfiguredProvider: hasAnyConfiguredProvider(resolveProviderCredentials()) })
  : preliminaryInvocation;

switch (invocation.kind) {
  case "version": {
    const certDate = getLatestCertificationDate();
    console.log(
      certDate ? `anvil ${VERSION} (certified: ${certDate.slice(0, 10)})` : `anvil ${VERSION}`
    );
    process.exit(0);
  }
  case "help":
    console.log(HELP);
    process.exit(0);
  case "setup":
    // Manual (re)configuration, or first-run onboarding when nothing is
    // configured — works any time, not just first run.
    runSetup(invocation.thenChat);
    break;
  case "gate":
    // Phase 25.6 — native guardian gate (fast scan; --full runs npm run gate).
    // Phase 26.2 — --watch continuously re-scans the dirty-file diff.
    // Phase 26.4 — --staged scans staged additions only (pre-commit surface).
    if (invocation.watch) {
      void runNativeGateWatch({ cwd: process.cwd(), staged: invocation.staged }).then((code) => process.exit(code));
    } else {
      process.exit(runNativeGate({ full: invocation.full, staged: invocation.staged }));
    }
    break;
  case "health":
    // Phase 26.5 — render the latest health snapshot for this project.
    process.exit(runHealth({}));
  case "init-usage-error":
    console.error("Usage: anvil init --guarded [--lang <typescript|python|rust|go>]");
    process.exit(1);
  case "subcommand-usage-error":
    console.error(`Unexpected argument for anvil ${invocation.subcommand}: ${invocation.argument}`);
    process.exit(1);
  case "init":
    // Phase 25.6 — `anvil init --guarded [--lang <id>]` provisions repo gates.
    process.exit(runGuardedInit({ lang: invocation.lang }));
  case "provider":
    void runProviderCommand(invocation.args).then((code) => process.exit(code));
    break;
  case "run":
    void runFromFlags(parseFlags(argv));
    break;
}
