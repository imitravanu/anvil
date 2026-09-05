import fs from "node:fs";
import path from "node:path";
import { anvilHome } from "../atomicWrite.js";

// ---------------------------------------------------------------------------
// MCP server configuration (~/.anvil/mcp.json, ANVIL_HOME-honoring).
// local stdio servers only. // ---------------------------------------------------------------------------

export interface McpServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  timeoutMs?: number;
}

export interface ValidatedMcpServer {
  id: string;
  command: string;
  args: string[];
  env: Record<string, string>;
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
 * Unknown transports (url:, sse:, …) are reported as misconfigured, never
 * attempted — v1 is stdio-only and says so.
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
    if (typeof cfg.url === "string" || typeof cfg.transport === "string") {
      problem("v1 is stdio-only (command/args); remote transports are not supported");
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
    const timeoutMs = cfg.timeoutMs ?? DEFAULT_MCP_TIMEOUT_MS;
    if (typeof timeoutMs !== "number" || !Number.isInteger(timeoutMs) || timeoutMs <= 0) {
      problem("\"timeoutMs\" must be a positive integer");
      continue;
    }
    servers.push({ id, command: cfg.command, args, env: env as Record<string, string>, timeoutMs });
  }
  return { servers, problems };
}
