import { spawn, type ChildProcess } from "node:child_process";
import { StringDecoder } from "node:string_decoder";

// ---------------------------------------------------------------------------
// MCP transport seam. Newline-delimited JSON-RPC 2.0 over stdio.
// 2.
// ---------------------------------------------------------------------------

export interface McpTransport {
  send(msg: string): void;
  lines(): AsyncIterable<string>;
  close(): void;
}

/** Cap on a single protocol line — a server streaming gigabytes without a
 * newline is either logging into the wrong pipe or hostile; either way the
 * transport must fail fast instead of OOMing the agent process. */
export const MAX_MCP_LINE_BYTES = 1024 * 1024;

export interface LineSplitter {
  push(chunk: Buffer): void;
}

/**
 * Newline-delimited framing over arbitrary chunk splits, multibyte-safe
 * (StringDecoder — a split UTF-8 sequence must not corrupt tool output).
 * Pure except for the callbacks; unit-tested without spawning anything.
 */
export function createLineSplitter(
  onLine: (line: string) => void,
  opts?: { maxLineBytes?: number; onLimitExceeded?: (bytes: number) => void }
): LineSplitter {
  const decoder = new StringDecoder("utf8");
  const max = opts?.maxLineBytes ?? MAX_MCP_LINE_BYTES;
  let buffer = "";
  let bufferBytes = 0;
  let broken = false;
  return {
    push(chunk: Buffer): void {
      if (broken) return;
      buffer += decoder.write(chunk);
      bufferBytes += chunk.length;
      if (bufferBytes > max) {
        broken = true;
        opts?.onLimitExceeded?.(bufferBytes);
        return;
      }
      let nl: number;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, nl).replace(/\r$/, "");
        buffer = buffer.slice(nl + 1);
        bufferBytes = Buffer.byteLength(buffer, "utf8");
        onLine(line);
        if (broken) return;
      }
    },
  };
}
const liveChildren = new Set<ChildProcess>();

/** Sync-kill every tracked server child. Wired to process exit by the CLI. */
export function killAllMcpServers(): void {
  for (const child of liveChildren) {
    try {
      if (child.pid != null && child.exitCode === null) {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {
          child.kill("SIGKILL");
        }
      }
    } catch {
      // already gone — never let shutdown cleanup throw
    }
  }
  liveChildren.clear();
}

export function createStdioTransport(
  command: string,
  args: string[],
  env: Record<string, string>
): McpTransport {
  // No shell, ever. Minimal base env + server env (bash.ts:66 precedent) —
  // Anvil's own environment (API keys) must not leak into servers. A few
  // location/identity vars are allowlisted because tool runtimes (npx,
  // Python, cargo) fail mysteriously without them.
  const baseEnv: Record<string, string> = {
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    LANG: process.env.LANG ?? "C.UTF-8",
  };
  for (const key of ["HOME", "USER", "TMPDIR", "TEMP", "SystemRoot"]) {
    const value = process.env[key];
    if (value !== undefined) baseEnv[key] = value;
  }
  const child = spawn(command, args, {
    stdio: ["pipe", "pipe", "inherit"], // server logs go to Anvil's stderr: visible, stream stays clean
    detached: true,
    env: { ...baseEnv, ...env },
  });
  liveChildren.add(child);
  const onExit = () => {
    liveChildren.delete(child);
  };
  child.on("exit", onExit);

  const waiters: ((line: string | null) => void)[] = [];
  const queued: string[] = [];
  let ended = false;

  const deliver = (line: string) => {
    const waiter = waiters.shift();
    if (waiter) waiter(line);
    else queued.push(line);
  };
  const finish = () => {
    if (ended) return;
    ended = true;
    for (const waiter of waiters.splice(0)) waiter(null);
  };
  const splitter = createLineSplitter(deliver, {
    onLimitExceeded: () => finish(), // fail fast; pending calls error as closed
  });
  child.stdout?.on("data", (chunk: Buffer) => splitter.push(chunk));
  child.on("exit", finish);
  // A spawn failure (ENOENT) does not always produce an exit event — prune
  // the registry and fail pending calls here too.
  child.on("error", () => {
    liveChildren.delete(child);
    finish();
  });
  // Async stdin failures (EPIPE after death) never reach try/catch at the
  // write site — fail fast here instead of hanging calls to timeout.
  child.stdin?.on("error", () => finish());

  return {
    send(msg: string): void {
      try {
        child.stdin?.write(msg + "\n");
      } catch {
        // write after death reads as a call error downstream, never a throw
      }
    },
    async *lines(): AsyncIterable<string> {
      while (true) {
        if (queued.length > 0) {
          yield queued.shift()!;
          continue;
        }
        if (ended) return;
        const line = await new Promise<string | null>((resolve) => {
          waiters.push(resolve);
        });
        if (line === null) return;
        yield line;
      }
    },
    close(): void {
      try {
        child.stdin?.end();
      } catch {
        // ignore
      }
      // Graceful first: SIGTERM lets servers flush; SIGKILL follows after a
      // grace period. The timer is unref'd so it never holds the process open,
      // and the exit handler clears it (also guarding the pid-reuse race).
      const killTree = (sig: NodeJS.Signals) => {
        try {
          if (child.pid != null && child.exitCode === null) {
            try {
              process.kill(-child.pid, sig);
            } catch {
              child.kill(sig);
            }
          }
        } catch {
          // already gone — never let cleanup throw
        }
      };
      killTree("SIGTERM");
      const grace = setTimeout(() => killTree("SIGKILL"), 500);
      (grace as unknown as { unref?: () => void }).unref?.();
      child.once("exit", () => clearTimeout(grace));
      liveChildren.delete(child);
    },
  };
}
