import fs from "node:fs";
import path from "node:path";
import { ProviderCredentials, ProviderId, MODEL_REGISTRY } from "../providers/index.js";
import { atomicWriteJson, withFileLockSync, anvilHome } from "../atomicWrite.js";
import { AnvilSettings } from "./types.js";
import { log } from "../logger.js";

export type { AnvilSettings } from "./types.js";
export * from "./mcp.js";
export * from "./rules.js";
export * from "./memory.js";
export * from "./constants.js";
export * from "./agentProfile.js";
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

/**
 * Product-boot credential resolution: `~/.anvil/credentials.json` merged with
 * the documented provider env vars, env taking precedence — `.env.example` and
 * the README provider table have promised this since the beginning, but the
 * product path read only the file, so `ANTHROPIC_API_KEY=… anvil` reported
 * "No provider is configured" while certification scripts honored the very
 * same variable (takeover 2026-10-10). One table, both surfaces:
 * certify-provider.ts resolves through this function. `saveCredential`
 * deliberately stays on file-only `loadCredentials()` so an env override is
 * never persisted to disk.
 */
export function resolveProviderCredentials(): ProviderCredentials {
  const file = loadCredentials();
  return {
    anthropicApiKey: process.env.ANTHROPIC_API_KEY || file.anthropicApiKey,
    openaiApiKey: process.env.OPENAI_API_KEY || file.openaiApiKey,
    geminiApiKey: process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || file.geminiApiKey,
    openrouterApiKey: process.env.OPENROUTER_API_KEY || file.openrouterApiKey,
    orcarouterApiKey: process.env.ORCAROUTER_API_KEY || file.orcarouterApiKey,
    groqApiKey: process.env.GROQ_API_KEY || file.groqApiKey,
    cerebrasApiKey: process.env.CEREBRAS_API_KEY || file.cerebrasApiKey,
    githubApiKey: process.env.GITHUB_TOKEN || process.env.GITHUB_API_KEY || file.githubApiKey,
    mistralApiKey: process.env.MISTRAL_API_KEY || file.mistralApiKey,
    inceptionApiKey: process.env.INCEPTION_API_KEY || file.inceptionApiKey,
    ollamaApiKey: process.env.OLLAMA_API_KEY || file.ollamaApiKey,
    qwencloudApiKey: process.env.QWENCLOUD_API_KEY || process.env.DASHSCOPE_API_KEY || file.qwencloudApiKey,
    agentrouterApiKey: process.env.AGENTROUTER_API_KEY || file.agentrouterApiKey,
  };
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
  withFileLockSync(SETTINGS_PATH(), () => atomicWriteJson(SETTINGS_PATH(), settings));
}

export function saveCredential(field: keyof ProviderCredentials, value: string): void {
  withFileLockSync(CREDENTIALS_PATH(), () => {
    const current = loadCredentials();
    const updated = { ...current, [field]: value };
    // Mode applied BEFORE the rename inside atomicWriteJson — no world-readable
    // window for API keys (the old write-then-chmod had one).
    atomicWriteJson(CREDENTIALS_PATH(), updated, { mode: 0o600 });
  });
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
  "agentrouter",
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

  // Unknown ids (typos) are a different mistake from "no API key yet" — report
  // them distinctly instead of the old misleading "not configured". The model
  // id stays free-form on purpose: OpenRouter-style providers accept arbitrary
  // model ids the registry can never enumerate.
  const checked = (candidate: string): ProviderId => {
    if (!(PROVIDER_ORDER as readonly string[]).includes(candidate)) {
      throw new UnknownProviderError(candidate);
    }
    if (!configured.includes(candidate as ProviderId)) {
      throw new ProviderSelectionError(candidate);
    }
    return candidate as ProviderId;
  };

  // A model in MODEL_REGISTRY implies its provider when that provider is
  // configured. This must sit at the SAME precedence level as the model's own
  // source (CLI flag > env > settings), not below settings — otherwise a
  // persisted `defaultProviderId` makes `--model <other-provider-model>`
  // unreachable: the saved provider would be paired with a foreign model and
  // fail at the provider call. A free-form model (absent from the registry)
  // still falls through to the provider source below it.
  const inferProvider = (model: string | undefined): ProviderId | undefined =>
    model
      ? (MODEL_REGISTRY.find(
          (m) => m.id === model && configured.includes(m.providerId as ProviderId)
        )?.providerId as ProviderId | undefined)
      : undefined;

  const flagModelProvider = inferProvider(input.flagModel);
  const envModelProvider = inferProvider(input.envModel);

  let providerId: ProviderId | undefined;
  if (input.flagProvider) {
    providerId = checked(input.flagProvider);
  } else if (flagModelProvider) {
    providerId = flagModelProvider;
  } else if (input.envProvider) {
    providerId = checked(input.envProvider);
  } else if (envModelProvider) {
    providerId = envModelProvider;
  } else if (input.settings?.defaultProviderId) {
    providerId = checked(input.settings.defaultProviderId);
  } else {
    const keyConfigured = PROVIDER_ORDER.filter(
      (id) =>
        typeof input.creds[`${id}ApiKey` as keyof ProviderCredentials] === "string" &&
        (input.creds[`${id}ApiKey` as keyof ProviderCredentials] as string).length > 0
    );
    providerId = inferProvider(input.settings?.defaultModel) ?? keyConfigured[0];
  }
  if (!providerId) return null;

  // A provider-only override must not carry a lower-precedence foreign model.
  const inheritedModels = [
    { model: input.envModel, provider: input.envProvider },
    { model: input.settings?.defaultModel, provider: input.settings?.defaultProviderId },
  ];
  const selectedModel = input.flagModel ?? inheritedModels.find(candidate => {
    if (!candidate.model || (candidate.provider && candidate.provider !== providerId)) return false;
    const registered = MODEL_REGISTRY.filter(m => m.id === candidate.model);
    return registered.length === 0 || registered.some(m => m.providerId === providerId);
  })?.model;
  const model =
    selectedModel ??
    MODEL_REGISTRY.find((m) => m.providerId === providerId)?.id ??
    "unknown-model";

  return { providerId, model };
}
