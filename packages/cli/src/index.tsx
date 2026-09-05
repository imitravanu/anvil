#!/usr/bin/env node
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
  syncFreeModels,
  createOpenRouterFreeSource,
  toToolDefinitions,
  MCP_TOOL_PREFIX,
  ProviderSelectionError,
  resolveProviderSelection,
  type ToolDefinition,
} from "@anvil/core";
import { App, FirstRunSetup, TuiPermissionBroker, isThemeName, loadCustomThemes } from "@anvil/tui";

// Detached MCP server children would outlive Anvil — SIGKILL them on exit.
// `exit` alone misses real signals (kill, terminal close), so hook those too.
// NOTE: process-group kill is Unix-only; on Windows each child is killed
// individually as a best effort (see transport fallbacks).
process.on("exit", killAllMcpServers);
for (const [sig, code] of [["SIGINT", 130], ["SIGTERM", 143], ["SIGHUP", 129]] as const) {
  process.on(sig, () => {
    try {
      killAllMcpServers();
    } finally {
      process.exit(code);
    }
  });
}

const VERSION = CORE_VERSION;

function parseFlags(argv: string[]): Record<string, string> {
  const flags: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--provider" || arg === "--model") {
      flags[arg.slice(2)] = argv[++i] ?? "";
    } else if (arg === "--no-mcp") {
      // Skip MCP server startup entirely (fast boot, no child processes).
      flags["no-mcp"] = "1";
    }
  }
  return flags;
}

const HELP = `Anvil — a terminal coding agent (v${VERSION})

Usage:
  anvil                     Start an interactive chat session
  anvil config              (Re)configure a provider API key
  anvil --version           Print the version and exit
  anvil --help              Show this help

Options:
  --provider <id>           Override the provider for this run
  --model <id>              Override the model for this run
  --no-mcp                  Skip MCP server startup (fast boot)

Environment:
  ANVIL_PROVIDER, ANVIL_MODEL — same as the flags, lower precedence

Config lives in ~/.anvil (credentials.json, settings.json, sessions/).
Set ANVIL_HOME to relocate the data dir (credentials, settings, sessions, cache).
Slash commands inside the app: /help /clear /connect /expand /ledger /mcp /model /rewind /theme /session /sync.
`;

// --- Startup crash guard: never leave the terminal in a broken raw-mode state. ---
let appInstance: { unmount: () => void } | null = null;

function crash(err: unknown): never {
  try {
    appInstance?.unmount();
  } catch {
    // unmount is best-effort during a fatal crash
  }
  try {
    // Ink owns raw mode while mounted; make sure a fatal crash can't strand it.
    (process.stdin as NodeJS.ReadStream).setRawMode?.(false);
  } catch {
    // not a TTY — nothing to restore
  }
  process.stderr.write(
    "Anvil hit an unexpected error:\n" +
      (err instanceof Error ? (err.stack ?? err.message) : String(err)) +
      "\n"
  );
  process.exit(1);
}
process.on("uncaughtException", crash);
// An aborted stream can reject after its consumer has stopped listening. Report
// that diagnostic, but do not forcibly tear down Ink (and leave raw mode broken).
process.on("unhandledRejection", (reason) => {
  process.stderr.write(
    "Anvil observed an unhandled promise rejection:\n" +
      (reason instanceof Error ? (reason.stack ?? reason.message) : String(reason)) +
      "\n"
  );
  process.exitCode = 1;
});

async function bootChat(): Promise<void> {
  // Phase 8 (B): restore the persisted free-model snapshot (any source) before
  // the model picker needs it. Staleness is surfaced, not hidden.
  const cached = loadModelsCacheV2();
  const cachedModels = collectModelsFromCache(cached);
  if (cachedModels.length > 0) {
    registerModels(cachedModels);
  }

  const creds = loadCredentials();
  const settings = loadSettings();
  const flags = parseFlags(process.argv.slice(2));

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

  const providers = createProviders(creds);
  // Phase 8 (B): one owner for free-model syncing — the coordinator. Single-flight
  // + TTL mean boot, picker, and /sync can never double-fetch or silently diverge.
  if (providers.openrouter?.isConfigured()) {
    void syncFreeModels({
      sources: [createOpenRouterFreeSource()],
      apiKeyBySource: { openrouter: creds.openrouterApiKey },
    });
  }

  const provider = providers[selection.providerId];
  if (!provider.isConfigured()) {
    console.error(
      `Provider "${selection.providerId}" is not configured. Check ~/.anvil/credentials.json.`
    );
    process.exit(1);
  }

  // Phase 10: connect MCP servers (10s cap each). Dead servers warn once
  // and never block chat; the executor reads this map live, so /mcp
  // reconnect refreshes routing with no stale state.
  const mcpConns = new Map<string, McpServerConnection>();
  const mcpNotices: string[] = [];
  const mcpDefs: ToolDefinition[] = [];
  if (flags["no-mcp"]) {
    mcpNotices.push("MCP disabled by --no-mcp.");
  } else {
  try {
    const mcp = await connectAllMcpServers(mcpConns, { timeoutMs: 10_000 });
    for (const problem of mcp.problems) mcpNotices.push(`MCP ${problem}`);
    if (mcp.connected > 0 || mcpNotices.length > 0) {
      const allMcpDefs = [...mcpConns.values()].flatMap((c) =>
        c.status === "ready" ? toToolDefinitions(c.id, c.tools) : []
      );
      const collision = dropCollidingMcpTools(
        TOOL_DEFINITIONS.map((d) => d.name),
        allMcpDefs
      );
      mcpDefs.push(...collision.kept);
      for (const d of collision.dropped) mcpNotices.push(`MCP dropped tool ${d.name} (name collision)`);
      registerExternalExecutor(
        MCP_TOOL_PREFIX,
        createMcpExecutor(() => mcpConns),
        describeMcpInput
      );
      if (mcp.connected > 0) {
        console.error(`MCP: ${mcp.tools} tool(s) from ${mcp.connected} server(s).`);
      }
    }
  } catch (err: any) {
    mcpNotices.push(`MCP connect failed: ${err?.message ?? String(err)}`);
  }
  } // end --no-mcp else
  for (const notice of mcpNotices) console.error(`⚠ ${notice}`);

  const broker = new TuiPermissionBroker();
  const mcpTools = mcpDefs.length > 0 ? [...TOOL_DEFINITIONS, ...mcpDefs] : undefined;
  const session = new AgentSession(provider, {
    systemPrompt: "You are Anvil, a terminal coding agent. Be concise.",
    model: selection.model,
    maxTokens: 8192,
    projectRoot: process.cwd(),
    permissionBroker: broker,
    ...(mcpTools !== undefined ? { tools: mcpTools } : {}),
  });

  const rawTheme = settings.theme;
  const customThemeNames = loadCustomThemes().themes;
  const initialTheme =
    (rawTheme !== undefined && (isThemeName(rawTheme) || rawTheme in customThemeNames))
      ? rawTheme
      : undefined;

  appInstance = render(
    <App
      session={session}
      broker={broker}
      providers={providers}
      providerId={selection.providerId}
      model={selection.model}
      initialTheme={initialTheme}
      sessionOptions={{
        systemPrompt: "You are Anvil, a terminal coding agent. Be concise.",
        maxTokens: 8192,
        projectRoot: process.cwd(),
        ...(mcpDefs.length > 0 ? { tools: [...TOOL_DEFINITIONS, ...mcpDefs] } : {}),
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

function runSetup(thenChat: boolean): void {
  // Interactive TUI requires a real terminal (raw-mode keyboard input).
  if (!process.stdin.isTTY) {
    console.error("Anvil needs an interactive terminal (stdin is not a TTY).");
    process.exit(1);
  }
  let instance: ReturnType<typeof render> | null = null;
  instance = render(
    <FirstRunSetup
      onDone={() => {
        instance?.unmount();
        appInstance = null;
        if (thenChat) void bootChat();
      }}
    />,
    { exitOnCtrlC: false }
  );
  appInstance = instance;
}

// --- Argument dispatch, before any TUI rendering. ---
const argv = process.argv.slice(2);
const first = argv[0];

if (first === "--version" || first === "-v") {
  console.log(`anvil ${VERSION}`);
  process.exit(0);
}
if (first === "--help" || first === "-h") {
  console.log(HELP);
  process.exit(0);
}

if (first === "config") {
  // Manual (re)configuration — works any time, not just first run.
  runSetup(false);
} else if (!hasAnyConfiguredProvider(loadCredentials())) {
  // First run: no API keys at all — onboard instead of hard-failing.
  runSetup(true);
} else {
  if (!process.stdin.isTTY) {
    console.error("Anvil needs an interactive terminal (stdin is not a TTY).");
    process.exit(1);
  }
  void bootChat();
}
