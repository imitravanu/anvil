import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ProviderCredentials } from "../providers/index.js";

const CREDENTIALS_PATH = path.join(os.homedir(), ".anvil", "credentials.json");

/**
 * Minimal credential loading — just enough for the TUI phase to run for real.
 * Phase 6 formalizes config beyond this (settings, keybindings, themes).
 *
 * Missing/unreadable file is not an error: it yields an empty credentials
 * object, and provider.isConfigured() reports what's actually usable.
 */
export function loadCredentials(): ProviderCredentials {
  try {
    const raw = fs.readFileSync(CREDENTIALS_PATH, "utf-8");
    return JSON.parse(raw) as ProviderCredentials;
  } catch {
    return {};
  }
}
