import { spawn, type ChildProcess } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import { getErrorMessage } from "../errors.js";
import {
  DEFAULT_MCP_REQUEST_TIMEOUT_MS,
  SSE_CONNECT_INITIAL_DELAY_MS,
  SSE_CONNECT_MAX_DELAY_MS,
  SSE_CONNECT_MAX_RETRIES,
} from "../config/constants.js";

// ---------------------------------------------------------------------------
// MCP transport seam. Newline-delimited JSON-RPC 2.0 over stdio.
// ---------------------------------------------------------------------------

export interface McpTransport {
  send(msg: string): void;
  lines(): AsyncIterable<string>;
  close(): void;
}

/**
 * Shared waiter/queue pump behind every transport: senders deliver parsed
 * payloads, readers drain them in order, finish() ends the stream and fails
 * pending readers so McpClient sees {closed:true} instead of hanging.
 */
export interface TransportPump {
  deliver(line: string): void;
  finish(): void;
  lines(): AsyncIterable<string>;
}

export function createTransportPump(): TransportPump {
  const waiters: ((line: string | null) => void)[] = [];
  const queued: string[] = [];
  let ended = false;
  return {
    deliver(line: string): void {
      const waiter = waiters.shift();
      if (waiter) waiter(line);
      else queued.push(line);
    },
    finish(): void {
      if (ended) return;
      ended = true;
      for (const waiter of waiters.splice(0)) waiter(null);
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
  };
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
  for (const ctrl of [...liveSseControllers]) {
    try {
      ctrl.abort();
    } catch {
      // already gone — never let shutdown cleanup throw
    }
  }
  liveSseControllers.clear();
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

  const pump = createTransportPump();
  const splitter = createLineSplitter((line) => pump.deliver(line), {
    onLimitExceeded: () => pump.finish(), // fail fast; pending calls error as closed
  });
  child.stdout?.on("data", (chunk: Buffer) => splitter.push(chunk));
  child.on("exit", () => pump.finish());
  // A spawn failure (ENOENT) does not always produce an exit event — prune
  // the registry and fail pending calls here too.
  child.on("error", () => {
    liveChildren.delete(child);
    pump.finish();
  });
  // Async stdin failures (EPIPE after death) never reach try/catch at the
  // write site — fail fast here instead of hanging calls to timeout.
  child.stdin?.on("error", () => pump.finish());

  return {
    send(msg: string): void {
      try {
        child.stdin?.write(msg + "\n");
      } catch {
        // write after death reads as a call error downstream, never a throw
      }
    },
    lines(): AsyncIterable<string> {
      return pump.lines();
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

// ---------------------------------------------------------------------------
// SSE transport: JSON-RPC 2.0 over HTTP+SSE (legacy event-stream profile).
// GET the server URL for an event stream, take the `endpoint` event as the
// POST target, multiplex JSON-RPC over it through the same McpTransport seam
// (McpClient is unchanged). POSTs answered inline (202-then-stream or direct
// JSON, streamable-HTTP style) are delivered too.
// Security: TLS is verified by fetch (no opt-out); only loopback tolerates
// plain http (enforced in config validation); headers and query strings are
// never logged — errors carry sanitizeSseUrl() output only.
// ---------------------------------------------------------------------------

export interface SseTransportOptions {
  headers?: Record<string, string>;
  /** Overall connect budget including retries (default: request timeout). */
  timeoutMs?: number;
  /** Test seam (defaults to global fetch). */
  fetchImpl?: typeof fetch;
}

export interface SseMessage {
  event: string;
  data: string;
}

/**
 * Incremental SSE frame parser: blank-line-delimited `field: value` blocks,
 * multibyte-safe at the byte layer (callers decode with TextDecoder first).
 * Pure except for the buffer; unit-tested without any network.
 */
export class SseFrameParser {
  private buf = "";

  push(text: string): SseMessage[] {
    // Normalize CRLF/CR, holding back a trailing CR that may split a CRLF
    // across chunks — normalizing it early would corrupt the next push.
    let hold = "";
    let work = this.buf + text;
    if (work.endsWith("\r")) {
      hold = "\r";
      work = work.slice(0, -1);
    }
    work = work.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    const blocks = work.split("\n\n");
    this.buf = (blocks.pop() ?? "") + hold;
    const out: SseMessage[] = [];
    for (const block of blocks) {
      if (block === "") continue;
      let event = "message";
      const data: string[] = [];
      let hasData = false;
      for (const line of block.split("\n")) {
        if (line === "" || line.startsWith(":")) continue; // keepalive comment
        const colon = line.indexOf(":");
        let field = line;
        let value = "";
        if (colon >= 0) {
          field = line.slice(0, colon);
          value = line.slice(colon + 1);
          if (value.startsWith(" ")) value = value.slice(1);
        }
        if (field === "event") event = value;
        else if (field === "data") {
          data.push(value);
          hasData = true;
        }
        // id:/retry: are reconnection hints for browsers — no listener here.
      }
      if (hasData) out.push({ event, data: data.join("\n") });
    }
    return out;
  }
}

/** Strip userinfo, query, and fragment so URLs are safe to print in errors. */
export function sanitizeSseUrl(url: string): string {
  try {
    const u = new URL(url);
    u.username = "";
    u.password = "";
    u.search = "";
    u.hash = "";
    return u.toString();
  } catch {
    return "(invalid url)";
  }
}

function unrefTimer(t: ReturnType<typeof setTimeout>): void {
  (t as unknown as { unref?: () => void }).unref?.();
}

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    unrefTimer(t);
  });
}

/** Live SSE abort handles, so process exit closes remote streams like children. */
const liveSseControllers = new Set<AbortController>();

function trackSseTransport(ctrl: AbortController): void {
  liveSseControllers.add(ctrl);
}

function untrackSseTransport(ctrl: AbortController): void {
  liveSseControllers.delete(ctrl);
}

export interface SseTransportRefs {
  transport: McpTransport;
  /** Resolved POST target (handy for tests/diagnostics; sanitized in errors). */
  endpoint: string;
}

async function openSseStream(
  sseUrl: string,
  headers: Record<string, string>,
  fetchImpl: typeof fetch,
  pump: TransportPump,
  remainingMs: () => number
): Promise<{ endpoint: string; streamCtrl: AbortController }> {
  const label = sanitizeSseUrl(sseUrl);
  const streamCtrl = new AbortController();
  trackSseTransport(streamCtrl);
  let res: Response;
  try {
    res = await fetchImpl(sseUrl, {
      method: "GET",
      headers: { ...headers, Accept: "text/event-stream" },
      signal: streamCtrl.signal,
    });
  } catch (err: unknown) {
    untrackSseTransport(streamCtrl);
    throw new Error(`SSE connect to ${label} failed: ${getErrorMessage(err)}`);
  }
  if (!res.ok || !res.body) {
    untrackSseTransport(streamCtrl);
    try {
      streamCtrl.abort();
    } catch {
      // ignore abort failures during failed connects
    }
    throw new Error(`SSE connect to ${label} failed: HTTP ${res.status}`);
  }
  // The GET stream is owned by a detached pump from here on: endpoint
  // discovery and all later server messages share one reader.
  let resolveEndpoint: (endpoint: string) => void = () => undefined;
  let rejectEndpoint: (err: Error) => void = () => undefined;
  const endpointReady = new Promise<string>((resolve, reject) => {
    resolveEndpoint = resolve;
    rejectEndpoint = reject;
  });
  const parser = new SseFrameParser();
  const decoder = new TextDecoder();
  void (async () => {
    try {
      const reader = res.body!.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        for (const msg of parser.push(decoder.decode(value, { stream: true }))) {
          if (msg.event === "endpoint") {
            try {
              resolveEndpoint(new URL(msg.data.trim(), sseUrl).toString());
            } catch {
              rejectEndpoint(new Error(`SSE server at ${label} sent an unusable endpoint`));
            }
          } else if (msg.data !== "") {
            pump.deliver(msg.data);
          }
        }
      }
    } catch {
      // Stream errors surface as closed transport; pending calls fail fast
      // and the 24.2 auto-reconnect path re-establishes the stream.
    } finally {
      // Teardown rides on streamCtrl.abort(): the pending read() rejects,
      // the loop exits here, and the lock releases with the reader. No
      // explicit cancel — racing cancel() against a locked reader rejects.
      pump.finish();
      rejectEndpoint(new Error(`SSE stream from ${label} ended before endpoint`));
    }
  })();
  const budget = remainingMs();
  if (budget <= 0) {
    try {
      streamCtrl.abort();
    } catch {
      // ignore
    }
    untrackSseTransport(streamCtrl);
    throw new Error(`SSE connect to ${label} timed out waiting for endpoint`);
  }
  const endpointTimer = setTimeout(() => {
    rejectEndpoint(new Error(`SSE connect to ${label} timed out waiting for endpoint`));
  }, budget);
  unrefTimer(endpointTimer);
  try {
    const endpoint = await endpointReady;
    return { endpoint, streamCtrl };
  } finally {
    clearTimeout(endpointTimer);
  }
}

/**
 * Open an SSE transport with bounded retries. Total wall time stays inside
 * timeoutMs; backoff doubles from the initial delay to the cap. Throws with
 * a sanitized (credential-free) message when the budget is exhausted.
 */
export async function createSseTransport(
  sseUrl: string,
  opts: SseTransportOptions = {}
): Promise<McpTransport> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_MCP_REQUEST_TIMEOUT_MS;
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new Error("SSE transport needs a fetch implementation");
  }
  const headers = opts.headers ?? {};
  const label = sanitizeSseUrl(sseUrl);
  const pump = createTransportPump();
  const deadline = Date.now() + timeoutMs;
  let attempt = 0;
  let lastErr = `SSE connect to ${label} failed`;
  for (;;) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    if (attempt > 0) {
      const backoff = Math.min(
        SSE_CONNECT_INITIAL_DELAY_MS * 2 ** (attempt - 1),
        SSE_CONNECT_MAX_DELAY_MS,
        Math.max(remaining, 0)
      );
      if (backoff > 0) await sleepMs(backoff);
    }
    attempt += 1;
    try {
      const { endpoint, streamCtrl } = await openSseStream(
        sseUrl,
        headers,
        fetchImpl,
        pump,
        () => deadline - Date.now()
      );
      return bindSseTransport(pump, streamCtrl, endpoint, sseUrl, headers, timeoutMs, fetchImpl);
    } catch (err: unknown) {
      lastErr = getErrorMessage(err);
      if (attempt > SSE_CONNECT_MAX_RETRIES) break;
    }
  }
  pump.finish();
  throw new Error(lastErr);
}

function bindSseTransport(
  pump: TransportPump,
  streamCtrl: AbortController,
  endpoint: string,
  sseUrl: string,
  headers: Record<string, string>,
  timeoutMs: number,
  fetchImpl: typeof fetch
): McpTransport {
  const label = sanitizeSseUrl(sseUrl);
  let closed = false;
  return {
    send(msg: string): void {
      if (closed) return;
      void (async () => {
        const postCtrl = new AbortController();
        const cap = setTimeout(() => {
          try {
            postCtrl.abort();
          } catch {
            // ignore abort failures
          }
        }, timeoutMs);
        unrefTimer(cap);
        try {
          const res = await fetchImpl(endpoint, {
            method: "POST",
            headers: { ...headers, "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
            body: msg,
            signal: postCtrl.signal,
          });
          if (res.status === 202) return; // accepted — answer arrives on the stream
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const contentType = res.headers.get("content-type") ?? "";
          const len = Number(res.headers.get("content-length") ?? "0");
          if (Number.isFinite(len) && len > MAX_MCP_LINE_BYTES) {
            throw new Error("response too large");
          }
          const text = await res.text();
          if (text.length > MAX_MCP_LINE_BYTES) throw new Error("response too large");
          const trimmed = text.trim();
          if (trimmed === "") return;
          if (contentType.includes("text/event-stream")) {
            const parser = new SseFrameParser();
            for (const m of parser.push(trimmed)) {
              if (m.data !== "") pump.deliver(m.data);
            }
          } else {
            pump.deliver(trimmed);
          }
        } catch {
          // Fail fast like stdio EPIPE: pending calls error as closed and the
          // auto-reconnect path re-establishes the stream. Never throws — the
          // McpTransport.send contract is fire-and-forget.
          pump.finish();
        } finally {
          clearTimeout(cap);
        }
      })();
    },
    lines(): AsyncIterable<string> {
      return pump.lines();
    },
    close(): void {
      if (closed) return;
      closed = true;
      untrackSseTransport(streamCtrl);
      try {
        streamCtrl.abort();
      } catch {
        // ignore abort failures during close
      }
      pump.finish();
    },
  };
}
