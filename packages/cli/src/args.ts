/**
 * CLI flag parsing, extracted from the interactive entry (`index.tsx`) so the
 * argument contract is unit-testable without mounting Ink or spawning a
 * process. Behavior is unchanged from the inline version.
 */

/**
 * Parse the argv tail into flags. Value-taking flags consume the next token.
 *
 * Errors (a value-taking flag with no value, or an unknown flag) print to
 * stderr and exit 1 — a typo used to be ignored silently, which opened plain
 * chat or an empty headless prompt instead of telling the user.
 */
/**
 * The CLI's dispatch decision, resolved from argv plus one fact the caller
 * supplies (whether any provider is configured). Extracted from the entry point
 * so the whole mode matrix is unit-testable without spawning a process.
 */
export type Invocation =
  | { kind: "version" }
  | { kind: "help" }
  | { kind: "setup"; thenChat: boolean }
  | { kind: "gate"; watch: boolean; full: boolean; staged: boolean }
  | { kind: "health" }
  | { kind: "init"; lang: string | undefined }
  | { kind: "init-usage-error" }
  | { kind: "run" };

/**
 * Resolve what the invocation should do, in precedence order:
 *   --version/-v, --help/-h (honored ANYWHERE) → subcommand → first-run
 *   onboarding → run.
 * `--version`/`--help` are position-independent on purpose: `anvil -y --help`
 * used to fall through and open an interactive chat instead of printing help.
 */
export function resolveInvocation(
  argv: string[],
  opts: { hasConfiguredProvider: boolean }
): Invocation {
  if (argv.includes("--version") || argv.includes("-v")) return { kind: "version" };
  if (argv.includes("--help") || argv.includes("-h")) return { kind: "help" };

  const first = argv[0];
  if (first === "config") return { kind: "setup", thenChat: false };
  if (first === "gate") {
    return {
      kind: "gate",
      watch: argv.includes("--watch"),
      full: argv.includes("--full"),
      staged: argv.includes("--staged"),
    };
  }
  if (first === "health") return { kind: "health" };
  if (first === "init") {
    if (!argv.includes("--guarded")) return { kind: "init-usage-error" };
    const langFlag = argv.indexOf("--lang");
    return { kind: "init", lang: langFlag >= 0 ? argv[langFlag + 1] : undefined };
  }
  // First run: no API keys at all — onboard instead of hard-failing.
  if (!opts.hasConfiguredProvider) return { kind: "setup", thenChat: true };
  return { kind: "run" };
}

export function parseFlags(argv: string[]): Record<string, string> {
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
