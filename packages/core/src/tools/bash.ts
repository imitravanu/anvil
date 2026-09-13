import { spawn, execSync } from "node:child_process";
import * as path from "node:path";
import { ToolContext, ToolDefinition, ToolExecutor } from "./types.js";
import {
  MAX_STREAM_BYTES,
  RUN_COMMAND_TIMEOUT_MS,
  MIN_COMMAND_TIMEOUT_MS,
  MAX_COMMAND_TIMEOUT_MS,
} from "../config/constants.js";

/**
 * Check if the current system environment supports running bash commands.
 * On Windows, checks if bash is available in PATH or inside Git Bash / WSL.
 */
export function checkWindowsShellSupport(): { supported: boolean; error?: string } {
  if (process.platform !== "win32") {
    return { supported: true };
  }
  try {
    execSync("where bash.exe", { stdio: "ignore" });
    return { supported: true };
  } catch {
    return {
      supported: false,
      error:
        "Anvil requires a bash-compatible shell on Windows. Please run inside Git Bash or WSL (Windows Subsystem for Linux).",
    };
  }
}

/**
 * Command timeout in ms, overridable via ANVIL_RUN_COMMAND_TIMEOUT_MS and
 * clamped to [1s, 10m]. Unset or non-finite → the built-in default.
 */
export function runCommandTimeoutMs(): number {
  const raw = Number(process.env.ANVIL_RUN_COMMAND_TIMEOUT_MS);
  if (!Number.isFinite(raw)) return RUN_COMMAND_TIMEOUT_MS;
  return Math.min(Math.max(Math.round(raw), MIN_COMMAND_TIMEOUT_MS), MAX_COMMAND_TIMEOUT_MS);
}

interface CapturedStream {
  text: string;
  truncated: boolean;
}

function captureStream(source: NodeJS.ReadableStream | null): CapturedStream & { stop: () => void } {
  const chunks: Buffer[] = [];
  let total = 0;
  let truncated = false;
  const onData = (chunk: Buffer) => {
    if (total >= MAX_STREAM_BYTES) {
      truncated = true;
      return; // keep draining so the child's pipe doesn't block, but stop storing
    }
    const room = MAX_STREAM_BYTES - total;
    const slice = chunk.length > room ? chunk.subarray(0, room) : chunk;
    if (chunk.length > room) truncated = true;
    chunks.push(slice);
    total += slice.length;
  };
  source?.on("data", onData);
  return {
    get text() {
      return Buffer.concat(chunks).toString("utf8");
    },
    get truncated() {
      return truncated;
    },
    stop: () => {
      source?.off("data", onData);
    },
  };
}

export const definition: ToolDefinition = {
  name: "run_command",
  description:
    "Run a shell command (bash -c) in the project root and capture stdout/stderr. " +
    "This is a mutating action — it requires permission. Output is capped at ~20KB per stream. " +
    "Commands that would destroy the filesystem outside the project (e.g. rm -rf /, " +
    "fork bombs, mkfs, writes to /dev devices) are refused without executing.",
  inputSchema: {
    type: "object",
    properties: {
      command: { type: "string", description: "The shell command to run" },
    },
    required: ["command"],
  },
  mutating: true,
};

// Defense in depth behind the permission prompt: a model can bury
// `rm -rf ~` inside a chained command (`npm run build && rm -rf ~`) that a
// hurried user might Allow. These patterns never spawn a child — the turn
// gets an isError tool_result explaining the refusal instead.
// A command segment is one `&&`/`;`/`|`-separated piece: flags in one segment
// must not be able to reach a target in another (`rm -rf ./build && rm -rf /`
// is still blocked because the second segment matches on its own).
function segments(command: string): string[] {
  return command.split(/[|;&]+/);
}

// rm with recursive+force flags whose target is the filesystem root, a
// top-level glob, or the user's home dir. Plain `rm -rf ./build` inside the
// project stays allowed — the permission prompt remains the gate for those.
function isRootWipe(rawSegment: string): boolean {
  // De-shell the segment first: quotes group targets (`rm -rf "$HOME"`),
  // and $(…) / `…` hide commands that run when the segment executes
  // (`echo $(rm -rf ~)`). After stripping, the patterns below see exactly
  // what bash would act on.
  const segment = rawSegment.replace(/["'`]/g, " ").replace(/\$\(|\)/g, " ");
  const m = segment.match(/\brm\b(.*)$/);
  if (!m) return false;
  const rest = m[1];
  const shortFlags = [...rest.matchAll(/(^|\s)-([a-zA-Z]+)/g)].map((x) => x[2]).join("");
  const longFlags = [...rest.matchAll(/--([a-z-]+)/g)].map((x) => x[1]);
  const recursive =
    shortFlags.includes("r") ||
    shortFlags.includes("R") ||
    longFlags.some((f) => f.startsWith("recursive"));
  const force = shortFlags.includes("f") || longFlags.some((f) => f.startsWith("force"));
  if (!(recursive && force)) return false;
  // Block: bare root (/), root glob (/*), home (~, $HOME), AND any top-level
  // system directory. A project-local `rm -rf ./build` stays allowed.
  const SYSTEM_PATHS = /(?:^|\s)(?:\/(?:\s|$|\*)|~|\$HOME|\$\{HOME\}|\/(?:usr|etc|var|dev|boot|lib|lib64|bin|sbin|opt|proc|sys|run|srv|tmp|root|mnt|media)(?:\s|\/|$))/;
  return SYSTEM_PATHS.test(rest);
}

const WHOLE_COMMAND_CHECKS: { test: (cmd: string) => boolean; reason: string }[] = [
  // Must see the full string: the segment splitter below would shred it.
  { test: (s) => /:\(\)\s*\{\s*:\|:&\s*\};:/.test(s), reason: "fork bomb" },
];

const SEGMENT_CHECKS: { test: (seg: string) => boolean; reason: string }[] = [
  { test: isRootWipe, reason: "recursive delete of filesystem root / home directory" },
  { test: (s) => /\bmkfs(\s|\.)/.test(s), reason: "filesystem formatting (mkfs)" },
  { test: (s) => /\bdd\b.*\bof=\/dev\//.test(s), reason: "raw write to a /dev device (dd)" },
  { test: (s) => />(>)?\s*\/dev\/sd[a-z]/.test(s), reason: "raw write to a block device" },
  { test: (s) => /\bchmod\s+[^\s]*-R/.test(s) && /(^|\s)\/(\s|$)/.test(s), reason: "recursive permission change on filesystem root" },
];

export function isBlockedCommand(command: string): string | null {
  for (const { test, reason } of WHOLE_COMMAND_CHECKS) {
    if (test(command)) return reason;
  }
  for (const seg of segments(command)) {
    for (const { test, reason } of SEGMENT_CHECKS) {
      if (test(seg)) return reason;
    }
  }
  return null;
}

// --- Read-only safe-list: known-harmless commands skip the permission prompt. ---

// First word must be exactly one of these binaries (no shell variables, globs,
// or metacharacters can smuggle a second command past the check — see below).
const READ_ONLY_BINARIES = new Set([
  "ls", "pwd", "cat", "head", "tail", "wc", "file", "stat", "du", "df",
  "tree", "which", "whoami", "date", "uname", "echo",
]);

// Binaries that PRINT the files named in their arguments. Without containment
// they would read arbitrary host files with no prompt (`cat ~/.ssh/id_rsa`)
// — the exact hole the read_file tool's path containment exists to close —
// so their path arguments must resolve inside the project root.
const FILE_READER_BINARIES = new Set(["ls", "cat", "head", "tail", "wc", "file", "stat", "du", "tree"]);

function stripShellQuotes(s: string): string {
  // Remove matching outer quotes (single or double)
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}

/** True iff every positional argument resolves inside projectRoot. */
function pathsInsideRoot(args: readonly string[], projectRoot: string): boolean {
  const root = path.resolve(projectRoot);
  for (const rawArg of args) {
    if (rawArg.startsWith("-")) continue; // flags and their attached values
    const arg = stripShellQuotes(rawArg);
    // bash expands these before the binary sees them — `~/.ssh/id_rsa` and
    // `$HOME/...` resolve OUTSIDE the project no matter what path.resolve says.
    if (arg.startsWith("~") || arg.startsWith("$")) return false;
    // Also reject any remaining unmatched quotes — sign of shell trickery
    if (/['"]/.test(arg)) return false;
    const resolved = path.isAbsolute(arg) ? path.resolve(arg) : path.resolve(root, arg);
    const rel = path.relative(root, resolved);
    if (rel !== "" && (rel === ".." || rel.startsWith(`..${path.sep}`))) return false;
  }
  return true;
}

// For multi-mode binaries, only these subcommands are considered read-only —
// `git status` is safe, `git push`/`git branch foo` are not.
const READ_ONLY_SUBCOMMANDS: Record<string, Set<string>> = {
  git: new Set(["status", "log", "diff", "show", "rev-parse"]),
  npm: new Set(["ls", "list", "view", "search", "outdated"]),
  node: new Set(["--version", "-v"]),
  python3: new Set(["--version", "-V"]),
  python: new Set(["--version", "-V"]),
  pip3: new Set(["list", "show", "freeze"]),
  pip: new Set(["list", "show", "freeze"]),
};

// Any redirection, pipe, chain, substitution, or expansion means the command
// is not the plain read-only invocation it claims to be (`cat a > b` writes,
// `echo hi; rm -rf x` chains). The permission prompt remains the gate there.
const SHELL_METACHARS = /[|;&<>()`$\\\n]/;

/**
 * True iff the command is a plain single invocation of a known read-only
 * binary (with an allowed subcommand where relevant) and contains no shell
 * metacharacters or globs. File-reader binaries additionally require every
 * positional argument to stay inside projectRoot — without a projectRoot they
 * are never auto-allowed (fail closed). Conservative by construction.
 */
export function isReadOnlyCommand(command: string, projectRoot?: string): boolean {
  const trimmed = command.trim();
  if (!trimmed || SHELL_METACHARS.test(trimmed)) return false;
  if (/[*?[]/.test(trimmed)) return false;
  const parts = trimmed.split(/\s+/);
  const bin = parts[0];
  const sub = READ_ONLY_SUBCOMMANDS[bin];
  if (sub) return parts.length > 1 && sub.has(parts[1]);
  if (!READ_ONLY_BINARIES.has(bin)) return false;
  if (FILE_READER_BINARIES.has(bin)) {
    if (!projectRoot) return false;
    return pathsInsideRoot(parts.slice(1), projectRoot);
  }
  return true; // pure printers — arguments are inert (metachars/globs already rejected)
}

export const execute: ToolExecutor = async (input, ctx: ToolContext) => {
  const { command } = input as { command: string };
  const winCheck = checkWindowsShellSupport();
  if (!winCheck.supported) {
    return {
      output: { command, error: winCheck.error },
      isError: true,
      summary: winCheck.error!,
    };
  }
  const blocked = isBlockedCommand(command);
  if (blocked) {
    return {
      output: { command, blocked, error: `Refused to run: ${blocked}.` },
      isError: true,
      summary: `Blocked destructive command: ${command} (${blocked})`,
    };
  }
  return new Promise((resolve) => {
    // detached: true puts the child in its own process group, which is what
    // makes process.kill(-pid) below kill the entire command tree (bash -c
    // wrappers mean the interesting process is often a grandchild).
    const child = spawn("bash", ["-c", command], {
      cwd: ctx.projectRoot,
      detached: true,
      // Commands do not need Anvil's credentials or arbitrary parent environment,
      // but standard system/user variables (HOME, USER, TMPDIR) are essential for git, npm, etc.
      env: {
        PATH: process.env.PATH ?? "/usr/bin:/bin",
        LANG: process.env.LANG ?? "C.UTF-8",
        ...(process.env.HOME ? { HOME: process.env.HOME } : {}),
        ...(process.env.USER ? { USER: process.env.USER } : {}),
        ...(process.env.LOGNAME ? { LOGNAME: process.env.LOGNAME } : {}),
        ...(process.env.TMPDIR ? { TMPDIR: process.env.TMPDIR } : {}),
        ...(process.env.SHELL ? { SHELL: process.env.SHELL } : {}),
      },
    });
    const stdout = captureStream(child.stdout);
    const stderr = captureStream(child.stderr);

    const killTree = () => {
      // Kill the whole tree — bash -c wrappers mean the interesting process is
      // often a grandchild; killing bash alone can leave it running.
      if (child.pid == null) return;
      if (process.platform === "win32") {
        try {
          child.kill("SIGKILL");
        } catch {
          // child already exited
        }
      } else {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {
          // ESRCH — child already exited; expected race
          child.kill("SIGKILL");
        }
      }
    };
    let timedOut = false;
    const onAbort = () => killTree();
    const timeoutMs = runCommandTimeoutMs();
    const timeout = setTimeout(() => {
      timedOut = true;
      killTree();
    }, timeoutMs);
    if (ctx.signal.aborted) onAbort();
    ctx.signal.addEventListener("abort", onAbort, { once: true });

    child.on("error", (err) => {
      ctx.signal.removeEventListener("abort", onAbort);
      clearTimeout(timeout);
      stdout.stop();
      stderr.stop();
      resolve({
        output: { command, error: err.message },
        isError: true,
        summary: `run_command failed to start: ${command}`,
      });
    });

    child.on("close", (code, signalName) => {
      ctx.signal.removeEventListener("abort", onAbort);
      clearTimeout(timeout);
      stdout.stop();
      stderr.stop();
      const aborted = ctx.signal.aborted;
      resolve({
        output: {
          command,
          exitCode: code,
          killedBySignal: signalName,
          aborted,
          timedOut,
          stdout: stdout.text,
          stderr: stderr.text,
          stdoutTruncated: stdout.truncated,
          stderrTruncated: stderr.truncated,
        },
        isError: aborted || timedOut || (code ?? 1) !== 0,
        summary: aborted
          ? `Cancelled: ${command}`
          : timedOut
            ? `Timed out after ${timeoutMs}ms: ${command}`
            : `Ran: ${command} (exit ${code})`,
      });
    });
  });
};

export const describe = async (input: unknown): Promise<string> => {
  const command = (input as { command?: unknown } | null | undefined)?.command;
  return `Run command: ${typeof command === "string" ? command : "(malformed input)"}`;
};
