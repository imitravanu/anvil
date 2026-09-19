#!/usr/bin/env node
import { getErrorMessage } from "@anvil/core";
import React from "react";
import { render } from "ink";
import {
  CORE_VERSION,
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
  loadSettings,
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
  resolveProviderSelection,
  buildSystemPrompt,
  getLatestCertificationDate,
  type ModelProvider,
  type ProviderId,
  type ToolDefinition,
} from "@anvil/core";

import { App, FirstRunSetup, TuiPermissionBroker, detectTerminalTheme, isThemeName, loadCustomThemes } from "@anvil/tui";
import { runHeadless, readStdin } from "./headless.js";
import { runGoalHeadless } from "./goalRunner.js";
import { runNativeGate, runNativeGateWatch } from "./gate.js";
import { runGuardedInit } from "./initGuarded.js";
import { enterAltScreen, exitAltScreen } from "./altScreen.js";

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

function parseFlags(argv: string[]): Record<string, string> {
  const flags: Record<string, string> = {};
  const nextValue = (i: number, flag: string): string => {
    const v = argv[i + 1];
    // A missing value or another flag means the user typo'd
    // (`anvil -p` with no text). Fail loudly instead of silently ignoring it
    // and falling through to chat/headless with an empty prompt. A single
    // leading dash is a legitimate value ("anvil -p -42 is the answer") —
    // only a doubled dash is treated as the next flag.
    if (v === undefined || v.startsWith("--")) {
      console.error(`Missing value for ${flag}. See \`anvil --help\`.`);
      process.exit(1);
    }
    return v;
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--provider" || arg === "--model") {
      flags[arg.slice(2)] = nextValue(i, arg);
      i++;
    } else if (arg === "--prompt" || arg === "-p") {
      flags.prompt = nextValue(i, arg);
      i++;
    } else if (arg === "--goal" || arg === "-g") {
      flags.goal = nextValue(i, arg);
      i++;
    } else if (arg === "--yes" || arg === "-y") {
      flags.yes = "1";
    } else if (arg === "--raw") {
      flags.raw = "1";
    } else if (arg === "--no-mcp") {
      // Skip MCP server startup entirely (fast boot, no child processes).
      flags["no-mcp"] = "1";
    } else if (!arg.startsWith("-")) {
      continue; // bare words are handled by the caller (subcommands)
    } else {
      // A typo'd flag used to be ignored silently — `anvil --promt x` opened
      // plain chat. Fail with the closest-sounding known flag instead.
      console.error(`Unknown flag: ${arg}. See \`anvil --help\`.`);
      process.exit(1);
    }
  }
  return flags;
}

const HELP = `Anvil — a terminal coding agent (v${VERSION})

Usage:
  anvil                     Start an interactive chat session
  anvil -p, --prompt <text> Run headless non-interactive turn (streams to stdout)
  anvil -g, --goal <text>   Run autonomous multi-step engineering mission
  anvil config              (Re)configure a provider API key
  anvil gate [--full|--watch]  Guardian scan of working-tree diff (--watch: continuous)
  anvil init --guarded      Provision AGENTS.md + .fresh-allowlist.json here
  anvil --version           Print the version and exit
  anvil --help              Show this help

Options:
  -p, --prompt <text>       Run headless turn and stream response to stdout
  -g, --goal <text>         Autonomous mission mode (decomposes, executes, critiques)
  -y, --yes                 Auto-approve mutating tools in headless mode
  --raw                     Suppress tool diagnostic messages on stderr
  --provider <id>           Override the provider for this run
  --model <id>              Override the model for this run
  --no-mcp                  Skip MCP server startup (fast boot)
  --watch                   (gate) continuously re-scan the working-tree diff

Environment:
  ANVIL_PROVIDER, ANVIL_MODEL — same as the flags, lower precedence
  ANVIL_NO_ALT_SCREEN=1 — stay in the main screen buffer (no alt-screen)

Config lives in ~/.anvil (credentials.json, settings.json, sessions/).
Set ANVIL_HOME to relocate the data dir (credentials, settings, sessions, cache).
Slash commands inside the app: /help /clear /connect /diff /expand /goal /image /ledger /mcp /model /retry /rewind /theme /session /sync.
`;

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
    // unmount is best-effort during a fatal crash
  }
  // Restore the main screen first so the crash detail is visible, not lost
  // in a discarded alt buffer.
  exitAltScreen();
  try {
    // Ink owns raw mode while mounted; make sure a fatal crash can't strand it.
    (process.stdin as NodeJS.ReadStream).setRawMode?.(false);
  } catch {
    // not a TTY — nothing to restore
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
  settings: ReturnType<typeof loadSettings>
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
    const mcp = await connectAllMcpServers(conns, { timeoutMs: 10_000 });
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
  const creds = loadCredentials();
  const settings = loadSettings();
  const selection = resolveSelectionOrExit(flags, creds, settings);

  const providers = createProviders(creds);
  const provider = providers[selection.providerId];
  if (!provider.isConfigured()) {
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
  const baseSystemPrompt = "You are Anvil, a terminal coding agent. Be concise.";
  // Plugin prompts ride the shared boot context (loaded once in
  // resolveBootContext); sessionTools already carries built-ins + plugins + MCP.
  const systemPrompt =
    ctx.pluginPrompts.length > 0
      ? buildSystemPrompt(`${baseSystemPrompt}\n\n${ctx.pluginPrompts.join("\n\n")}`, projectRoot)
      : buildSystemPrompt(baseSystemPrompt, projectRoot);

  const session = new AgentSession(provider, {
    systemPrompt,
    model,
    maxTokens: 8192,
    projectRoot,
    permissionBroker: broker,
    // Closed-loop verification is a core product behavior, not a goal-mode
    // extra: after mutations, the detected test runner gates the turn.
    autoVerify: true,
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
        systemPrompt,
        maxTokens: 8192,
        projectRoot,
        autoVerify: true,
        ...(ctx.sessionTools !== undefined ? { tools: ctx.sessionTools } : {}),
      }}
      mcp={{
        list: () => [...mcpConns.values()],
        notices: mcpNotices,
        reconnect: () => connectAllMcpServers(mcpConns, { timeoutMs: 10_000 }),
      }}
    />,
    { exitOnCtrlC: false }
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
      onDone={() => {
        instance?.unmount();
        appInstance = null;
        if (thenChat) void bootChat(parseFlags(process.argv.slice(2)));
        else exitAltScreen();
      }}
    />,
    { exitOnCtrlC: false }
  );
  appInstance = instance;
}

// --- Argument dispatch, before any TUI rendering. ---
const argv = process.argv.slice(2);
const first = argv[0];

// Honored anywhere — `anvil -y --help` used to open an interactive chat.
if (argv.includes("--version") || argv.includes("-v")) {
  const certDate = getLatestCertificationDate();
  if (certDate) {
    console.log(`anvil ${VERSION} (certified: ${certDate.slice(0, 10)})`);
  } else {
    console.log(`anvil ${VERSION}`);
  }
  process.exit(0);
}

if (argv.includes("--help") || argv.includes("-h")) {
  console.log(HELP);
  process.exit(0);
}

if (first === "config") {
  // Manual (re)configuration — works any time, not just first run.
  runSetup(false);
} else if (first === "gate") {
  // Phase 25.6 — native guardian gate (fast scan; --full runs npm run gate).
  // Phase 26.2 — --watch continuously re-scans the dirty-file diff.
  if (argv.includes("--watch")) {
    void runNativeGateWatch({ cwd: process.cwd() }).then((code) => process.exit(code));
  } else {
    process.exit(runNativeGate({ full: argv.includes("--full") }));
  }
} else if (first === "init") {
  // Phase 25.6 — `anvil init --guarded [--lang <id>]` provisions repo gates.
  const langFlag = argv.indexOf("--lang");
  const lang = langFlag >= 0 ? argv[langFlag + 1] : undefined;
  if (!argv.includes("--guarded")) {
    console.error("Usage: anvil init --guarded [--lang <typescript|python|rust|go>]");
    process.exit(1);
  }
  process.exit(runGuardedInit({ lang }));
} else if (!hasAnyConfiguredProvider(loadCredentials())) {
  // First run: no API keys at all — onboard instead of hard-failing.
  runSetup(true);
} else {
  const flags = parseFlags(argv);
  void (async () => {
    if (flags.goal && flags.goal.trim()) {
      await bootGoal(flags.goal.trim(), flags);
      return;
    }

    const stdinText = await readStdin();
    const hasPromptFlag = Boolean(flags.prompt && flags.prompt.trim());
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
  })();
}
