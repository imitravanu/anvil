import fs from "node:fs";
import path from "node:path";
import { ProviderCredentials, ProviderId, MODEL_REGISTRY } from "../providers/index.js";
import { atomicWriteJson, anvilHome } from "../atomicWrite.js";
import { AnvilSettings } from "./types.js";
import { log } from "../logger.js";

export type { AnvilSettings } from "./types.js";
export * from "./mcp.js";
export * from "./rules.js";
export * from "./memory.js";
export * from "./constants.js";
export { anvilHome }; // single home-dir resolver (see atomicWrite.ts)


const CREDENTIALS_PATH = (): string => path.join(anvilHome(), "credentials.json");
const SETTINGS_PATH = (): string => path.join(anvilHome(), "settings.json");

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Minimal credential loading — just enough for the TUI phase to run for real.
 * Missing/unreadable file is not an error: it yields an empty credentials
 * object, and provider.isConfigured() reports what's actually usable.
 * Non-object JSON is also treated as empty (never half-trusted).
 */
export function loadCredentials(): ProviderCredentials {
  const credPath = CREDENTIALS_PATH();
  try {
    const raw = JSON.parse(fs.readFileSync(credPath, "utf-8"));
    if (process.platform !== "win32") {
      try {
        const stat = fs.statSync(credPath);
        const mode = stat.mode & 0o777;
        if (mode !== 0o600) {
          log.warn(`${credPath} has permissions ${mode.toString(8)} (expected 600)`);
        }
      } catch {
        // ignore stat failures
      }
    }
    if (!isRecord(raw)) return {};
    return raw as ProviderCredentials;
  } catch {
    // credentials missing on first run — expected
    return {};
  }
}

export function loadSettings(): AnvilSettings {
  try {
    const raw = JSON.parse(fs.readFileSync(SETTINGS_PATH(), "utf-8"));
    if (!isRecord(raw)) return {};
    return raw as AnvilSettings;
  } catch {
    // settings missing — use defaults
    return {};
  }
}

export function saveSettings(settings: AnvilSettings): void {
  atomicWriteJson(SETTINGS_PATH(), settings);
}

export function saveCredential(field: keyof ProviderCredentials, value: string): void {
  const current = loadCredentials();
  const updated = { ...current, [field]: value };
  // Mode applied BEFORE the rename inside atomicWriteJson — no world-readable
  // window for API keys (the old write-then-chmod had one).
  atomicWriteJson(CREDENTIALS_PATH(), updated, { mode: 0o600 });
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
  // Only provider API-key fields count. "Any non-empty string field in the
  // credentials file" works today only because every field happens to be a key;
  // a future non-secret field (region, endpoint) would falsely report a
  // configured install and skip first-run onboarding. Derived from
  // PROVIDER_ORDER so adding a provider cannot silently go unconfigured.
  return PROVIDER_ORDER.some((id) => {
    const value = creds[`${id}ApiKey` as keyof ProviderCredentials];
    return typeof value === "string" && value.length > 0;
  });
}

const PROVIDER_ORDER: ProviderId[] = [
  "anthropic",
  "openai",
  "gemini",
  "openrouter",
  "orcarouter",
  "groq",
  "github",
  "cerebras",
  "mistral",
  "inception",
  "ollama",
  "qwencloud",
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

export class UnknownProviderError extends ProviderSelectionError {
  constructor(providerId: string) {
    super(providerId);
    this.name = "UnknownProviderError";
    this.message =
      `Unknown provider "${providerId}". Known providers: ${PROVIDER_ORDER.join(", ")}. ` +
      `Check for typos (this used to misreport as "not configured").`;
  }
}

/**
 * Resolve which provider/model to boot with. Precedence (highest first):
 * CLI flag → env var → settings.json → first configured provider in
 * PROVIDER_ORDER with its first MODEL_REGISTRY model. Returns null when no
 * provider is configured at all (first-run setup should handle that).
 */
const KEYLESS_PROVIDERS = new Set<ProviderId>(["ollama"]);

export function resolveProviderSelection(input: SelectionInput): ProviderSelection | null {
  const configured = PROVIDER_ORDER.filter(
    (id) =>
      KEYLESS_PROVIDERS.has(id) ||
      (typeof input.creds[`${id}ApiKey` as keyof ProviderCredentials] === "string" &&
        (input.creds[`${id}ApiKey` as keyof ProviderCredentials] as string).length > 0)
  );

  const providerRaw =
    input.flagProvider ?? input.envProvider ?? input.settings?.defaultProviderId;
  const modelRaw = input.flagModel ?? input.envModel ?? input.settings?.defaultModel;

  let providerId: ProviderId | undefined;
  if (providerRaw) {
    // Unknown ids (typos) are a different mistake from "no API key yet" —
    // report them distinctly instead of the old misleading "not configured".
    // The model id stays free-form on purpose: OpenRouter-style providers
    // accept arbitrary model ids the registry can never enumerate.
    if (!(PROVIDER_ORDER as readonly string[]).includes(providerRaw)) {
      throw new UnknownProviderError(providerRaw);
    }
    if (!configured.includes(providerRaw as ProviderId)) {
      throw new ProviderSelectionError(providerRaw);
    }
    providerId = providerRaw as ProviderId;
  } else {
    const keyConfigured = PROVIDER_ORDER.filter(
      (id) =>
        typeof input.creds[`${id}ApiKey` as keyof ProviderCredentials] === "string" &&
        (input.creds[`${id}ApiKey` as keyof ProviderCredentials] as string).length > 0
    );
    providerId = keyConfigured[0];
  }
  if (!providerId) return null;

  const model =
    modelRaw ??
    MODEL_REGISTRY.find((m) => m.providerId === providerId)?.id ??
    "unknown-model";

  return { providerId, model };
}
