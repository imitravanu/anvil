import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ProviderCredentials, ProviderId, MODEL_REGISTRY } from "../providers/index.js";
import { AnvilSettings } from "./types.js";

export type { AnvilSettings } from "./types.js";

const CREDENTIALS_PATH = path.join(os.homedir(), ".anvil", "credentials.json");
const SETTINGS_PATH = path.join(os.homedir(), ".anvil", "settings.json");

/**
 * Minimal credential loading — just enough for the TUI phase to run for real.
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

export function loadSettings(): AnvilSettings {
  try {
    return JSON.parse(fs.readFileSync(SETTINGS_PATH, "utf-8"));
  } catch {
    return {};
  }
}

export function saveSettings(settings: AnvilSettings): void {
  fs.mkdirSync(path.dirname(SETTINGS_PATH), { recursive: true });
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2), "utf-8");
}

export function saveCredential(field: keyof ProviderCredentials, value: string): void {
  const current = loadCredentials();
  const updated = { ...current, [field]: value };
  fs.mkdirSync(path.dirname(CREDENTIALS_PATH), { recursive: true });
  fs.writeFileSync(CREDENTIALS_PATH, JSON.stringify(updated, null, 2), "utf-8");
  fs.chmodSync(CREDENTIALS_PATH, 0o600);
}

export {
  loadModelsCache,
  saveModelsCache,
  loadModelsCacheV2,
  saveModelsCacheV2,
  isModelsCacheFresh,
  collectModelsFromCache,
} from "../providers/index.js";

export function hasAnyConfiguredProvider(creds: ProviderCredentials): boolean {
  return Object.values(creds).some((v) => typeof v === "string" && v.length > 0);
}

const PROVIDER_ORDER: ProviderId[] = [
  "anthropic",
  "openai",
  "gemini",
  "openrouter",
  "groq",
  "github",
  "cerebras",
  "mistral",
  "ollama",
];

export interface SelectionInput {
  // 1. CLI flags (highest)
  flagProvider?: string;
  flagModel?: string;
  // 2. Environment variables
  envProvider?: string;
  envModel?: string;
  // 3. settings.json
  settings?: AnvilSettings;
  // 4. fallback needs to know what's actually usable
  creds: ProviderCredentials;
}

export interface ProviderSelection {
  providerId: ProviderId;
  model: string;
}

export class ProviderSelectionError extends Error {
  constructor(providerId: string) {
    super(`Requested provider "${providerId}" is not configured. Add its API key with \`anvil config\` or choose a configured provider.`);
    this.name = "ProviderSelectionError";
  }
}

/**
 * Resolve which provider/model to boot with. Precedence (highest first):
 * CLI flag → env var → settings.json → first configured provider in
 * PROVIDER_ORDER with its first MODEL_REGISTRY model. Returns null when no
 * provider is configured at all (first-run setup should handle that).
 */
export function resolveProviderSelection(input: SelectionInput): ProviderSelection | null {
  const configured = PROVIDER_ORDER.filter(
    (id) =>
      typeof input.creds[`${id}ApiKey` as keyof ProviderCredentials] === "string" &&
      (input.creds[`${id}ApiKey` as keyof ProviderCredentials] as string).length > 0
  );

  const providerRaw =
    input.flagProvider ?? input.envProvider ?? input.settings?.defaultProviderId;
  const modelRaw = input.flagModel ?? input.envModel ?? input.settings?.defaultModel;

  let providerId: ProviderId | undefined;
  if (providerRaw) {
    if (!configured.includes(providerRaw as ProviderId)) {
      throw new ProviderSelectionError(providerRaw);
    }
    providerId = providerRaw as ProviderId;
  } else {
    providerId = configured[0]; // hardcoded fallback: first configured provider
  }
  if (!providerId) return null;

  const model =
    modelRaw ??
    MODEL_REGISTRY.find((m) => m.providerId === providerId)?.id ??
    "unknown-model";

  return { providerId, model };
}
