import fs from "node:fs";
import path from "node:path";
import { anvilHome } from "../atomicWrite.js";

// ---------------------------------------------------------------------------
// MCP server configuration (~/.anvil/mcp.json, ANVIL_HOME-honoring).
// Local stdio servers (command/args/env) and remote SSE servers (url/headers).
// Secrets in headers are never logged — see transport.ts sanitizeSseUrl().
// ---------------------------------------------------------------------------

export type McpTransportType = "stdio" | "sse";

export interface McpServerConfig {
  transport?: McpTransportType;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
}

export interface ValidatedMcpServer {
  id: string;
  transport: McpTransportType;
  command: string;
  args: string[];
  env: Record<string, string>;
  url: string;
  headers: Record<string, string>;
  timeoutMs: number;
}

export interface McpConfigProblem {
  id: string;
  error: string;
}

export interface McpConfig {
  servers: ValidatedMcpServer[];
  problems: McpConfigProblem[];
}

export const DEFAULT_MCP_TIMEOUT_MS = 60_000;
const SERVER_ID_RE = /^[a-z0-9-_]{1,40}$/;

export function mcpConfigPath(): string {
  return path.join(anvilHome(), "mcp.json");
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Load + validate mcp.json. Missing/corrupt → empty config, never throws.
 * Unknown transport names are reported as misconfigured, never attempted.
 */
export function loadMcpConfig(): McpConfig {
  let text: string;
  try {
    text = fs.readFileSync(mcpConfigPath(), "utf-8");
  } catch {
    return { servers: [], problems: [] }; // no file yet — normal, silent
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { servers: [], problems: [{ id: "(file)", error: "mcp.json is not valid JSON" }] };
  }
  if (!isRecord(raw)) {
    return { servers: [], problems: [{ id: "(file)", error: "mcp.json must be an object with a \"servers\" map" }] };
  }
  const serversRaw = (raw as { servers?: unknown }).servers ?? {};
  if (!isRecord(serversRaw)) {
    return { servers: [], problems: [{ id: "(file)", error: "\"servers\" must be an object map" }] };
  }
  const servers: ValidatedMcpServer[] = [];
  const problems: McpConfigProblem[] = [];
  for (const [id, cfg] of Object.entries(serversRaw)) {
    const problem = (error: string) => problems.push({ id, error });
    if (!SERVER_ID_RE.test(id)) {
      problem(`invalid server id (want [a-z0-9-_]{1,40})`);
      continue;
    }
    if (!isRecord(cfg)) {
      problem("server entry must be an object");
      continue;
    }
    // Transport selection: explicit field wins, a bare url implies sse,
    // everything else is a local stdio server.
    const transportRaw = cfg.transport ?? (typeof cfg.url === "string" ? "sse" : "stdio");
    if (transportRaw !== "stdio" && transportRaw !== "sse") {
      problem(`unknown transport ${JSON.stringify(transportRaw)} (want "stdio" | "sse")`);
      continue;
    }
    const timeoutMs = cfg.timeoutMs ?? DEFAULT_MCP_TIMEOUT_MS;
    if (typeof timeoutMs !== "number" || !Number.isInteger(timeoutMs) || timeoutMs <= 0) {
      problem("\"timeoutMs\" must be a positive integer");
      continue;
    }
    if (transportRaw === "sse") {
      const err = validateSseEntry(cfg);
      if (err) {
        problem(err);
        continue;
      }
      // Narrowed by validateSseEntry above; guards keep tsc honest without casts.
      const url = typeof cfg.url === "string" ? cfg.url.trim() : "";
      const headersRaw = cfg.headers ?? {};
      const headers: Record<string, string> = isRecord(headersRaw)
        ? Object.fromEntries(Object.entries(headersRaw).filter((e): e is [string, string] => typeof e[1] === "string"))
        : {};
      servers.push({ id, transport: "sse", command: "", args: [], env: {}, url, headers, timeoutMs });
      continue;
    }
    if (typeof cfg.url === "string" || (cfg.headers !== undefined && !isRecord(cfg.headers))) {
      problem("stdio servers use command/args/env; url/headers need \"transport\": \"sse\"");
      continue;
    }
    if (typeof cfg.command !== "string" || cfg.command.length === 0) {
      problem("missing required string \"command\"");
      continue;
    }
    const args = cfg.args ?? [];
    if (!Array.isArray(args) || !args.every((a) => typeof a === "string")) {
      problem("\"args\" must be an array of strings");
      continue;
    }
    const env = cfg.env ?? {};
    if (!isRecord(env) || !Object.values(env).every((v) => typeof v === "string")) {
      problem("\"env\" must be an object of string values");
      continue;
    }
    servers.push({ id, transport: "stdio", command: cfg.command, args, env: env as Record<string, string>, url: "", headers: {}, timeoutMs });
  }
  return { servers, problems };
}

/** Loopback hosts where plain http is tolerated (dev servers, no secrets on the wire beyond the box). */
function isLoopbackHostname(host: string): boolean {
  const h = host.toLowerCase();
  return h === "localhost" || h === "127.0.0.1" || h === "::1" || h === "[::1]";
}

/**
 * Validate the remote half of an sse entry. Returns a problem string, or null
 * when the entry is usable. Never logs headers or query strings — problem
 * strings must stay safe to print (credentials live in headers/params).
 */
function validateSseEntry(cfg: Record<string, unknown>): string | null {
  if (typeof cfg.url !== "string" || cfg.url.trim().length === 0) {
    return "sse servers need \"url\" (https://…, http only for localhost)";
  }
  let parsed: URL;
  try {
    parsed = new URL(cfg.url.trim());
  } catch {
    return "sse \"url\" is not a valid URL";
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return "sse \"url\" must be http(s)";
  }
  if (parsed.protocol === "http:" && !isLoopbackHostname(parsed.hostname)) {
    return "sse \"url\" must be https except for localhost (no plaintext credentials on the wire)";
  }
  if (typeof cfg.command === "string" && cfg.command.length > 0) {
    return "sse servers use \"url\", not \"command\"";
  }
  if (cfg.headers !== undefined) {
    if (!isRecord(cfg.headers) || !Object.values(cfg.headers).every((v) => typeof v === "string")) {
      return "\"headers\" must be an object of string values";
    }
  }
  return null;
}
