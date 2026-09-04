#!/usr/bin/env node
import React from "react";
import { render } from "ink";
import {
  CORE_VERSION,
  createProviders,
  hasAnyConfiguredProvider,
  AgentSession,
  loadCredentials,
  loadSettings,
  loadModelsCache,
  registerModels,
  syncOpenRouterModels,
  ProviderSelectionError,
  resolveProviderSelection,
} from "@anvil/core";
import { App, FirstRunSetup, TuiPermissionBroker } from "@anvil/tui";

const VERSION = CORE_VERSION;

function parseFlags(argv: string[]): Record<string, string> {
  const flags: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--provider" || arg === "--model") {
      flags[arg.slice(2)] = argv[++i] ?? "";
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

Environment:
  ANVIL_PROVIDER, ANVIL_MODEL — same as the flags, lower precedence

Config lives in ~/.anvil (credentials.json, settings.json, sessions/).
Slash commands inside the app: /help /clear /connect /model /theme /session /sync.
`;

// --- Startup crash guard: never leave the terminal in a broken raw-mode state. ---
function crash(err: unknown): never {
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

function bootChat(): void {
  const cachedModels = loadModelsCache();
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
  // Auto-sync live free models from OpenRouter in background
  if (providers.openrouter?.isConfigured()) {
    syncOpenRouterModels(creds.openrouterApiKey).catch(() => {});
  }

  const provider = providers[selection.providerId];
  if (!provider.isConfigured()) {
    console.error(
      `Provider "${selection.providerId}" is not configured. Check ~/.anvil/credentials.json.`
    );
    process.exit(1);
  }

  const broker = new TuiPermissionBroker();
  const session = new AgentSession(provider, {
    systemPrompt: "You are Anvil, a terminal coding agent. Be concise.",
    model: selection.model,
    maxTokens: 8192,
    projectRoot: process.cwd(),
    permissionBroker: broker,
  });

  const rawTheme = settings.theme;
  const initialTheme =
    rawTheme === "dark" || rawTheme === "light" || rawTheme === "highContrast"
      ? rawTheme
      : undefined;

  render(
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
        if (thenChat) bootChat();
      }}
    />,
    { exitOnCtrlC: false }
  );
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
  bootChat();
}
