import { spawn, type ChildProcess } from "node:child_process";

// ---------------------------------------------------------------------------
// MCP transport seam (Phase 10). Newline-delimited JSON-RPC 2.0 over stdio.
// See docs/PHASE-10-SPEC.md §3.2.
// ---------------------------------------------------------------------------

export interface McpTransport {
  send(msg: string): void;
  lines(): AsyncIterable<string>;
  close(): void;
}

// Live children, so Anvil can SIGKILL servers on shutdown — detached:true
// children would otherwise outlive the parent (bash.ts killTree precedent).
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
  // Anvil's own environment (API keys) must not leak into servers.
  const child = spawn(command, args, {
    stdio: ["pipe", "pipe", "inherit"], // server logs go to Anvil's stderr: visible, stream stays clean
    detached: true,
    env: {
      PATH: process.env.PATH ?? "/usr/bin:/bin",
      LANG: process.env.LANG ?? "C.UTF-8",
      ...env,
    },
  });
  liveChildren.add(child);
  const onExit = () => {
    liveChildren.delete(child);
  };
  child.on("exit", onExit);

  let buffer = "";
  const waiters: ((line: string | null) => void)[] = [];
  const queued: string[] = [];
  let ended = false;

  const pump = (chunk: Buffer) => {
    buffer += chunk.toString("utf8");
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl).replace(/\r$/, "");
      buffer = buffer.slice(nl + 1);
      const waiter = waiters.shift();
      if (waiter) waiter(line);
      else queued.push(line);
    }
  };
  child.stdout?.on("data", pump);
  const finish = () => {
    if (ended) return;
    ended = true;
    for (const waiter of waiters.splice(0)) waiter(null);
  };
  child.on("exit", finish);
  child.on("error", finish);

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
      try {
        if (child.pid != null && child.exitCode === null) {
          try {
            process.kill(-child.pid, "SIGKILL");
          } catch {
            child.kill("SIGKILL");
          }
        }
      } catch {
        // ignore
      }
      liveChildren.delete(child);
    },
  };
}
