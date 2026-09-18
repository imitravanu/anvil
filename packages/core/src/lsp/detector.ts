import { execSync } from "node:child_process";
import { getErrorMessage } from "../errors.js";
import { log } from "../logger.js";
import type { LspLanguage, LspServerCommand } from "./types.js";

const SERVER_COMMANDS: LspServerCommand[] = [
  { language: "typescript", command: "typescript-language-server", args: ["--stdio"] },
  { language: "python", command: "pyright-langserver", args: ["--stdio"] },
  { language: "rust", command: "rust-analyzer", args: [] },
  { language: "go", command: "gopls", args: [] },
];

function commandExists(command: string): boolean {
  try {
    const probe = process.platform === "win32" ? `where ${command}` : `command -v ${command}`;
    execSync(probe, { stdio: "ignore" });
    return true;
  } catch (err: unknown) {
    log.debug(`LSP probe missed ${command}: ${getErrorMessage(err)}`);
    return false;
  }
}

function languageForPath(filePath: string): LspLanguage | null {
  if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(filePath)) return "typescript";
  if (filePath.endsWith(".py")) return "python";
  if (filePath.endsWith(".rs")) return "rust";
  if (filePath.endsWith(".go")) return "go";
  return null;
}

/**
 * Auto-detect usable language servers on PATH. Pure side-effect-free
 * selection except the PATH probe; never throws.
 */
export function detectLspServers(): LspServerCommand[] {
  const found: LspServerCommand[] = [];
  for (const entry of SERVER_COMMANDS) {
    try {
      if (commandExists(entry.command)) found.push(entry);
    } catch (err: unknown) {
      log.warn(`LSP detection skipped ${entry.command}: ${getErrorMessage(err)}`);
    }
  }
  return found;
}

/** Pick the server for a file, or null when none is installed. */
export function serverForPath(filePath: string, servers: LspServerCommand[] = detectLspServers()): LspServerCommand | null {
  const language = languageForPath(filePath);
  if (!language) return null;
  return servers.find((s) => s.language === language) ?? null;
}
