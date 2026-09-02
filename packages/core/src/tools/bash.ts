import { spawn } from "node:child_process";
import { ToolContext, ToolDefinition, ToolExecutor } from "./types.js";

const MAX_STREAM_BYTES = 20 * 1024; // per stream, same cap as the prototype
export const RUN_COMMAND_TIMEOUT_MS = 120_000;

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
    "This is a mutating action — it requires permission. Output is capped at ~20KB per stream.",
  inputSchema: {
    type: "object",
    properties: {
      command: { type: "string", description: "The shell command to run" },
    },
    required: ["command"],
  },
  mutating: true,
};

export const execute: ToolExecutor = async (input, ctx: ToolContext) => {
  const { command } = input as { command: string };
  return new Promise((resolve) => {
    // detached: true puts the child in its own process group, which is what
    // makes process.kill(-pid) below kill the entire command tree (bash -c
    // wrappers mean the interesting process is often a grandchild).
    const child = spawn("bash", ["-c", command], {
      cwd: ctx.projectRoot,
      detached: true,
      // Commands do not need Anvil's credentials or arbitrary parent environment.
      env: { PATH: process.env.PATH ?? "/usr/bin:/bin", LANG: process.env.LANG ?? "C.UTF-8" },
    });
    const stdout = captureStream(child.stdout);
    const stderr = captureStream(child.stderr);

    const killTree = () => {
      // Kill the whole tree — bash -c wrappers mean the interesting process is
      // often a grandchild; killing bash alone can leave it running.
      try {
        if (child.pid != null) process.kill(-child.pid, "SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
    };
    let timedOut = false;
    const onAbort = () => killTree();
    const timeout = setTimeout(() => {
      timedOut = true;
      killTree();
    }, RUN_COMMAND_TIMEOUT_MS);
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
            ? `Timed out after ${RUN_COMMAND_TIMEOUT_MS}ms: ${command}`
            : `Ran: ${command} (exit ${code})`,
      });
    });
  });
};

export const describe = async (input: unknown): Promise<string> => {
  return `Run command: ${(input as { command: string }).command}`;
};
