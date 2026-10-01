import { COMMANDS } from "@anvil/tui";

/**
 * `--help` text (G9, AUDIT-2026-09-30). The slash-command line is DERIVED from
 * the TUI command registry — a literal copy drifted (15 of 20 commands) before,
 * so there is no copy anymore: the registry is the single owner.
 */
export function buildHelpText(version: string): string {
  const slashCommands = COMMANDS.map((c) => `/${c.name}`).join(" ");
  return `Anvil — a terminal coding agent (v${version})

Usage:
  anvil                     Start an interactive chat session
  anvil -p, --prompt <text> Run headless non-interactive turn (streams to stdout)
  anvil -g, --goal <text>   Run autonomous multi-step engineering mission
  anvil config              (Re)configure a provider API key
  anvil gate [--full|--watch|--staged]  Guardian scan of the working-tree diff (--watch: continuous, --staged: staged additions only)
  anvil health              Show codebase health: freshness, cleanliness, allowlist drain
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
  --verbose                 Info-level diagnostics on stderr (ANVIL_LOG=info)
  --watch                   (gate) continuously re-scan the working-tree diff

Environment:
  ANVIL_PROVIDER, ANVIL_MODEL — same as the flags, lower precedence
  ANVIL_NO_ALT_SCREEN=1 — stay in the main screen buffer (no alt-screen)

Config lives in ~/.anvil (credentials.json, settings.json, sessions/).
Set ANVIL_HOME to relocate the data dir (credentials, settings, sessions, cache).
Slash commands inside the app: ${slashCommands}.
`;
}
