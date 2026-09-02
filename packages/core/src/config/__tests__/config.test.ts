import { describe, expect, it } from "vitest";
import { resolveProviderSelection } from "../index.js";
import type { ProviderCredentials } from "../../providers/index.js";

const geminiOnly: ProviderCredentials = { geminiApiKey: "g-key" };
const both: ProviderCredentials = { anthropicApiKey: "a-key", geminiApiKey: "g-key" };

describe("resolveProviderSelection", () => {
  it("flag level: --provider/--model beat everything", () => {
    const sel = resolveProviderSelection({
      flagProvider: "anthropic",
      flagModel: "claude-sonnet-5",
      envProvider: "gemini",
      settings: { defaultProviderId: "gemini", defaultModel: "gemini-3.6-flash" },
      creds: both,
    });
    expect(sel).toEqual({ providerId: "anthropic", model: "claude-sonnet-5" });
  });

  it("env level: ANVIL_PROVIDER/ANVIL_MODEL beat settings.json", () => {
    const sel = resolveProviderSelection({
      envProvider: "anthropic",
      envModel: "claude-opus-5",
      settings: { defaultProviderId: "gemini", defaultModel: "gemini-3.6-flash" },
      creds: both,
    });
    expect(sel).toEqual({ providerId: "anthropic", model: "claude-opus-5" });
  });

  it("settings level: settings.json beats the fallback", () => {
    const sel = resolveProviderSelection({
      settings: { defaultProviderId: "gemini", defaultModel: "gemini-3.6-flash" },
      creds: both, // fallback would pick anthropic (first in PROVIDER_ORDER)
    });
    expect(sel).toEqual({ providerId: "gemini", model: "gemini-3.6-flash" });
  });

  it("fallback level: first configured provider with its first registry model", () => {
    const sel = resolveProviderSelection({ creds: both });
    expect(sel).toEqual({ providerId: "anthropic", model: "claude-opus-5" });
    expect(resolveProviderSelection({ creds: geminiOnly })).toEqual({
      providerId: "gemini",
      model: "gemini-3.1-pro-preview", // first gemini entry in MODEL_REGISTRY
    });
  });

  it("returns null when nothing is configured", () => {
    expect(resolveProviderSelection({ creds: {} })).toBeNull();
  });
});