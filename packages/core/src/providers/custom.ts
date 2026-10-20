import fs from "node:fs";
import path from "node:path";
import { anvilHome, atomicWriteJson, withFileLockSync } from "../atomicWrite.js";
import { getErrorMessage } from "../errors.js";
import { ChatCompletionsStyleProvider } from "./openai.js";
import { ResponsesStyleProvider } from "./responses.js";
import { AnthropicProvider } from "./anthropic.js";
import type { ModelInfo, ModelProvider } from "./types.js";

export type CustomProviderProtocol = "openai-chat" | "openai-responses" | "anthropic";

export interface CustomProviderConfig {
  id: `custom:${string}`;
  name: string;
  baseUrl: string;
  auth: "bearer" | "none";
  apiKeyEnv?: string;
  protocol?: CustomProviderProtocol;
  headers?: Record<string, string>;
  maxTokensParam?: "max_tokens" | "max_completion_tokens";
  streamUsage?: boolean;
  models?: Array<{
    id: string;
    name?: string;
    contextWindow: number;
    supportsTools?: boolean;
    supportsVision?: boolean;
    isFree?: boolean;
  }>;
}

const configPath = () => path.join(anvilHome(), "providers.json");
const keysPath = () => path.join(anvilHome(), "provider-keys.json");
const envName = /^[A-Za-z_][A-Za-z0-9_]*$/;
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0 && !/[\x00-\x1f\x7f-\x9f]/.test(value);

function invalid(field: string): never {
  throw new Error(`Invalid custom provider ${field}. Check ~/.anvil/providers.json or run anvil config.`);
}

/** Validate an untrusted file without echoing keys or header values into errors. */
export function validateCustomProvider(value: unknown): CustomProviderConfig {
  if (!record(value)) return invalid("definition");
  const allowed = new Set([
    "id",
    "name",
    "baseUrl",
    "auth",
    "apiKeyEnv",
    "protocol",
    "headers",
    "maxTokensParam",
    "streamUsage",
    "models",
  ]);
  if (Object.keys(value).some(key => !allowed.has(key))) {
    return invalid("field (API keys belong in provider-keys.json, not providers.json)");
  }
  if (typeof value.id !== "string" || !/^custom:[a-z][a-z0-9-]*$/.test(value.id)) {
    return invalid("id (use custom:lowercase-name)");
  }
  if (!text(value.name)) return invalid("name");
  if (!text(value.baseUrl)) return invalid("baseUrl");
  let url: URL;
  try {
    url = new URL(value.baseUrl);
  } catch {
    // intentional: replace the parser error so a credential-bearing URL is never echoed.
    return invalid("baseUrl (use an absolute http(s) URL)");
  }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    return invalid("baseUrl (http(s), without credentials, query or fragment)");
  }
  if (value.auth !== "bearer" && value.auth !== "none") return invalid("auth (bearer or none)");
  if (value.apiKeyEnv !== undefined && (typeof value.apiKeyEnv !== "string" || !envName.test(value.apiKeyEnv))) {
    return invalid("apiKeyEnv");
  }
  if (value.auth === "none" && value.apiKeyEnv !== undefined) return invalid("apiKeyEnv (auth is none)");
  if (
    value.protocol !== undefined &&
    value.protocol !== "openai-chat" &&
    value.protocol !== "openai-responses" &&
    value.protocol !== "anthropic"
  ) {
    return invalid("protocol (must be openai-chat, openai-responses, or anthropic)");
  }
  if (
    value.maxTokensParam !== undefined &&
    value.maxTokensParam !== "max_tokens" &&
    value.maxTokensParam !== "max_completion_tokens"
  ) {
    return invalid("maxTokensParam");
  }
  if (value.streamUsage !== undefined && typeof value.streamUsage !== "boolean") return invalid("streamUsage");
  const headers: Record<string, string> = {};
  const seenHeaders = new Set<string>();
  if (value.headers !== undefined) {
    if (!record(value.headers)) return invalid("headers");
    for (const [key, content] of Object.entries(value.headers)) {
      const lower = key.toLowerCase();
      if (
        !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(key) ||
        ["authorization", "host", "content-length", "connection", "transfer-encoding", "cookie", "proxy-authorization"].includes(lower) ||
        seenHeaders.has(lower)
      ) {
        return invalid("header name (reserved or duplicate)");
      }
      if (!text(content)) return invalid("header value");
      if (/(?:key|token|secret)/i.test(key) && !content.startsWith("$")) return invalid("secret header (use $ENV_NAME)");
      if (content.startsWith("$") && !envName.test(content.slice(1))) return invalid("header environment reference");
      seenHeaders.add(lower);
      headers[key] = content;
    }
  }

  let models: CustomProviderConfig["models"] | undefined = undefined;
  if (value.models !== undefined) {
    if (!Array.isArray(value.models) || value.models.length === 0) return invalid("models (at least one is required)");
    const seen = new Set<string>();
    models = value.models.map(model => {
      if (!record(model) || !text(model.id) || seen.has(model.id)) return invalid("model id (missing or duplicate)");
      if (!Number.isSafeInteger(model.contextWindow) || typeof model.contextWindow !== "number" || model.contextWindow <= 0) {
        return invalid("model contextWindow (positive integer)");
      }
      if (model.name !== undefined && !text(model.name)) return invalid("model name");
      for (const key of ["supportsTools", "supportsVision", "isFree"]) {
        if (model[key] !== undefined && typeof model[key] !== "boolean") return invalid(`model ${key}`);
      }
      if (Object.keys(model).some(key => !["id", "name", "contextWindow", "supportsTools", "supportsVision", "isFree"].includes(key))) {
        return invalid("model field");
      }
      seen.add(model.id);
      return {
        id: model.id,
        contextWindow: model.contextWindow,
        ...(typeof model.name === "string" ? { name: model.name } : {}),
        ...(typeof model.supportsTools === "boolean" ? { supportsTools: model.supportsTools } : {}),
        ...(typeof model.supportsVision === "boolean" ? { supportsVision: model.supportsVision } : {}),
        ...(typeof model.isFree === "boolean" ? { isFree: model.isFree } : {}),
      };
    });
  }

  return {
    id: value.id as `custom:${string}`,
    name: value.name.trim(),
    baseUrl: url.href.replace(/\/+$/, ""),
    auth: value.auth,
    ...(value.protocol !== undefined ? { protocol: value.protocol } : {}),
    ...(typeof value.apiKeyEnv === "string" ? { apiKeyEnv: value.apiKeyEnv } : {}),
    ...(value.headers !== undefined ? { headers } : {}),
    ...(value.maxTokensParam ? { maxTokensParam: value.maxTokensParam } : {}),
    ...(typeof value.streamUsage === "boolean" ? { streamUsage: value.streamUsage } : {}),
    ...(models !== undefined ? { models } : {}),
  };
}

function readJson(file: string): unknown {
  let source: string;
  try {
    source = fs.readFileSync(file, "utf8");
  } catch (err) {
    if (record(err) && (err.code === "ENOENT" || err.code === "ENOTDIR")) return undefined;
    throw new Error(`Cannot read ${path.basename(file)}: ${getErrorMessage(err)}`);
  }
  try {
    return JSON.parse(source);
  } catch {
    // intentional: protect user credentials by not leaking corrupted raw file content in error
    throw new Error(`Invalid JSON in ${path.basename(file)}. No configuration was changed.`);
  }
}

export function loadCustomProviders(): CustomProviderConfig[] {
  const raw = readJson(configPath());
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) return invalid("file (expected an array)");
  const configs = raw.map(validateCustomProvider);
  if (new Set(configs.map(config => config.id)).size !== configs.length) return invalid("file (duplicate provider ids)");
  return configs;
}

function loadKeys(): Record<string, string> {
  const raw = readJson(keysPath());
  if (raw === undefined) return {};
  if (!record(raw) || Object.entries(raw).some(([key, value]) => !/^custom:[a-z][a-z0-9-]*$/.test(key) || !text(value))) {
    throw new Error("Invalid provider-keys.json. No credentials were changed.");
  }
  return Object.fromEntries(Object.entries(raw).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
}

export function saveCustomProvider(input: CustomProviderConfig, apiKey?: string): void {
  const config = validateCustomProvider(input);
  if (apiKey !== undefined && !text(apiKey)) return invalid("API key");
  fs.mkdirSync(anvilHome(), { recursive: true, mode: 0o700 });
  withFileLockSync(configPath(), () => {
    const configs = loadCustomProviders();
    const previousKeys = loadKeys();
    const keys = { ...previousKeys };
    if (config.auth === "none" || config.apiKeyEnv) delete keys[config.id];
    else if (apiKey !== undefined) keys[config.id] = apiKey;
    if (config.auth === "bearer" && !config.apiKeyEnv && !keys[config.id]) return invalid("API key (required for bearer auth)");
    // Credentials first: a failed config write may leave an unused key, never
    // a new provider pointing at credentials that were not saved.
    atomicWriteJson(keysPath(), keys, { mode: 0o600 });
    const index = configs.findIndex(old => old.id === config.id);
    if (index === -1) configs.push(config); else configs[index] = config;
    try {
      atomicWriteJson(configPath(), configs, { mode: 0o600 });
    } catch (err) {
      atomicWriteJson(keysPath(), previousKeys, { mode: 0o600 });
      throw err;
    }
  });
}

export function removeCustomProvider(id: CustomProviderConfig["id"]): void {
  withFileLockSync(configPath(), () => {
    const configs = loadCustomProviders();
    const keys = loadKeys();
    delete keys[id];
    atomicWriteJson(configPath(), configs.filter(config => config.id !== id), { mode: 0o600 });
    atomicWriteJson(keysPath(), keys, { mode: 0o600 });
    const settingsPath = path.join(anvilHome(), "settings.json");
    withFileLockSync(settingsPath, () => {
      const settings = readJson(settingsPath);
      if (record(settings) && settings.defaultProviderId === id) {
        delete settings.defaultProviderId;
        delete settings.defaultModel;
        atomicWriteJson(settingsPath, settings);
      }
    });
  });
}

function apiKeyFor(config: CustomProviderConfig): string | undefined {
  return config.apiKeyEnv ? process.env[config.apiKeyEnv] : loadKeys()[config.id];
}

function resolvedHeaders(config: CustomProviderConfig): Record<string, string> | undefined {
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(config.headers ?? {})) {
    const resolved = value.startsWith("$") ? process.env[value.slice(1)] : value;
    if (!resolved || !text(resolved)) return undefined;
    headers[key] = resolved;
  }
  return headers;
}

export function isCustomProviderConfigured(config: CustomProviderConfig): boolean {
  return (config.auth === "none" || text(apiKeyFor(config)?.trim())) && resolvedHeaders(config) !== undefined;
}

export function customProviderModels(configs: CustomProviderConfig[]): ModelInfo[] {
  return configs.flatMap(config => {
    if (config.models && config.models.length > 0) {
      return config.models.map(model => ({
        id: model.id,
        providerId: config.id,
        displayName: model.name ?? model.id,
        contextWindow: model.contextWindow,
        supportsTools: model.supportsTools ?? true,
        supportsVision: model.supportsVision ?? false,
        ...(model.isFree !== undefined ? { isFree: model.isFree } : {}),
        certified: "untested" as const,
      }));
    }
    return [
      {
        id: "default",
        providerId: config.id,
        displayName: `${config.name} (Default)`,
        contextWindow: 128_000,
        supportsTools: true,
        supportsVision: false,
        certified: "untested" as const,
      },
    ];
  });
}

export async function fetchCustomProviderModels(
  config: CustomProviderConfig,
  apiKeyOverride?: string,
  signal?: AbortSignal
): Promise<ModelInfo[]> {
  const base = config.baseUrl.replace(/\/+$/, "");
  const url = `${base}/models`;
  const key = apiKeyOverride ?? (config.auth === "none" ? undefined : apiKeyFor(config)?.trim());
  const headers: Record<string, string> = {
    ...resolvedHeaders(config),
  };
  if (config.auth === "bearer" && key) {
    headers["Authorization"] = `Bearer ${key}`;
  }

  const res = await fetch(url, {
    method: "GET",
    headers,
    signal,
  });

  if (!res.ok) {
    let msg = `HTTP ${res.status} ${res.statusText}`;
    try {
      const errBody = await res.text();
      const parsed = JSON.parse(errBody);
      if (parsed.error?.message) msg = parsed.error.message;
    } catch {
      // intentional: fallback to status code on unparseable error body
    }
    throw new Error(`Failed to fetch models from ${url}: ${msg}`);
  }

  const json = (await res.json()) as unknown;
  let rawList: Array<Record<string, unknown>> = [];

  if (record(json) && Array.isArray(json.data)) {
    rawList = json.data.filter(record);
  } else if (record(json) && Array.isArray(json.models)) {
    rawList = json.models.filter(record);
  } else if (Array.isArray(json)) {
    rawList = json.map(item => (typeof item === "string" ? { id: item } : item)).filter(record);
  }

  const result: ModelInfo[] = [];
  for (const item of rawList) {
    const id = String(item.id || item.name || "");
    if (!id) continue;
    result.push({
      id,
      providerId: config.id,
      displayName: typeof item.name === "string" && item.name ? item.name : id,
      contextWindow: typeof item.context_length === "number" ? item.context_length : 128_000,
      supportsTools: true,
      supportsVision: false,
      certified: "untested" as const,
    });
  }
  return result;
}

export interface CustomProviderTestResult {
  ok: boolean;
  latencyMs: number;
  modelsCount: number;
  models: string[];
  protocol: CustomProviderProtocol;
  error?: string;
}

export async function testCustomProvider(
  config: CustomProviderConfig,
  apiKeyOverride?: string,
  signal?: AbortSignal
): Promise<CustomProviderTestResult> {
  const start = Date.now();
  const protocol = config.protocol ?? "openai-chat";
  const key = apiKeyOverride ?? (config.auth === "none" ? undefined : apiKeyFor(config)?.trim());
  const secrets = [
    key,
    ...Object.entries(config.headers ?? {})
      .filter(([name]) => /key|token|secret/i.test(name))
      .map(([, value]) => (value.startsWith("$") ? process.env[value.slice(1)] : value)),
  ].filter((value): value is string => Boolean(value && value.trim()));

  const redact = (str: string): string => {
    let result = str;
    for (const secret of secrets) {
      if (secret) result = result.split(secret).join("[redacted]");
    }
    return result;
  };

  try {
    const models = await fetchCustomProviderModels(config, apiKeyOverride, signal);
    const latencyMs = Date.now() - start;
    return {
      ok: true,
      latencyMs,
      modelsCount: models.length,
      models: models.map(m => m.id),
      protocol,
    };
  } catch (err) {
    const latencyMs = Date.now() - start;
    const rawError = getErrorMessage(err);
    return {
      ok: false,
      latencyMs,
      modelsCount: config.models?.length ?? 0,
      models: config.models?.map(m => m.id) ?? [],
      protocol,
      error: redact(rawError),
    };
  }
}

export function createCustomProvider(config: CustomProviderConfig, apiKeyOverride?: string): ModelProvider {
  const key = apiKeyOverride ?? (config.auth === "none" ? undefined : apiKeyFor(config)?.trim());
  const headers = resolvedHeaders(config);
  const protocol = config.protocol ?? "openai-chat";
  const configured = apiKeyOverride ? true : isCustomProviderConfigured(config);

  let adapter: ModelProvider;
  if (protocol === "openai-responses") {
    adapter = new ResponsesStyleProvider({
      id: config.id,
      displayName: config.name,
      baseURL: config.baseUrl,
      apiKey: configured ? (config.auth === "none" ? "anvil-no-auth" : key) : undefined,
      defaultHeaders: { ...headers, ...(config.auth === "none" ? { Authorization: "" } : {}) },
    });
  } else if (protocol === "anthropic") {
    adapter = new AnthropicProvider({
      id: config.id,
      displayName: config.name,
      baseURL: config.baseUrl,
      apiKey: configured ? (config.auth === "none" ? "anvil-no-auth" : key) : undefined,
      defaultHeaders: headers,
    });
  } else {
    adapter = new ChatCompletionsStyleProvider({
      id: config.id,
      displayName: config.name,
      baseURL: config.baseUrl,
      apiKey: configured ? (config.auth === "none" ? "anvil-no-auth" : key) : undefined,
      defaultHeaders: { ...headers, ...(config.auth === "none" ? { Authorization: null } : {}) },
      maxTokensParam: config.maxTokensParam ?? "max_tokens",
      streamUsage: config.streamUsage ?? true,
      modelCapabilities: customProviderModels([config]),
      supportsVision: false,
      isolateEndpoint: true,
    });
  }

  const secrets = [
    key,
    ...Object.entries(headers ?? {})
      .filter(([name]) => /key|token|secret/i.test(name))
      .map(([, value]) => value),
  ].filter((value): value is string => Boolean(value));

  return {
    id: adapter.id,
    displayName: adapter.displayName,
    isConfigured: () => adapter.isConfigured(),
    async *streamCompletion(request) {
      for await (const event of adapter.streamCompletion(request)) {
        if (event.type !== "error") {
          yield event;
          continue;
        }
        let message = event.message;
        for (const secret of secrets) message = message.split(secret).join("[redacted]");
        yield { ...event, message };
      }
    },
  };
}
