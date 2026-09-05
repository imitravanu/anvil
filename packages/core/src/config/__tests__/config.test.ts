import { describe, expect, it, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  ProviderSelectionError,
  anvilHome,
  loadCredentials,
  loadSettings,
  resolveProviderSelection,
  saveCredential,
  saveSettings,
} from "../index.js";
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
      model: "gemini-3.6-flash", // first gemini entry in MODEL_REGISTRY (free-tier eligible)
    });
  });

  it("returns null when nothing is configured", () => {
    expect(resolveProviderSelection({ creds: {} })).toBeNull();
  });

  it("rejects an explicitly selected provider that is not configured", () => {
    expect(() =>
      resolveProviderSelection({ flagProvider: "anthropic", creds: geminiOnly })
    ).toThrow(ProviderSelectionError);
  });

  it("distinguishes unknown provider ids (typos) from missing keys", () => {
    expect(() =>
      resolveProviderSelection({ envProvider: "not-a-provider", creds: geminiOnly })
    ).toThrow(/Unknown provider "not-a-provider"/);
  });
});

describe("anvilHome relocation", () => {
  const saved = process.env.ANVIL_HOME;
  let tmp: string;
  afterEach(() => {
    if (saved === undefined) delete process.env.ANVIL_HOME;
    else process.env.ANVIL_HOME = saved;
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("credentials and settings live under ANVIL_HOME when set", () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "anvil-home-"));
    process.env.ANVIL_HOME = tmp;
    expect(anvilHome()).toBe(path.resolve(tmp));

    saveCredential("geminiApiKey", "test-key");
    saveSettings({ defaultModel: "gemini-3.6-flash" });

    expect(fs.existsSync(path.join(tmp, "credentials.json"))).toBe(true);
    expect(fs.existsSync(path.join(tmp, "settings.json"))).toBe(true);
    expect(loadCredentials()).toEqual({ geminiApiKey: "test-key" });
    expect(loadSettings()).toEqual({ defaultModel: "gemini-3.6-flash" });
  });

  it("falls back to ~/.anvil when ANVIL_HOME is unset", () => {
    delete process.env.ANVIL_HOME;
    expect(anvilHome()).toBe(path.join(os.homedir(), ".anvil"));
  });

  it("non-object JSON loads as empty, never half-trusted", () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "anvil-home-"));
    process.env.ANVIL_HOME = tmp;
    fs.writeFileSync(path.join(tmp, "credentials.json"), `["not", "an", "object"]`, "utf-8");
    fs.writeFileSync(path.join(tmp, "settings.json"), `"just a string"`, "utf-8");
    expect(loadCredentials()).toEqual({});
    expect(loadSettings()).toEqual({});
  });

  it("saved credentials are mode 0600 from creation (no readable window)", () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "anvil-home-"));
    process.env.ANVIL_HOME = tmp;
    saveCredential("geminiApiKey", "k");
    const mode = fs.statSync(path.join(tmp, "credentials.json")).mode & 0o777;
    expect(mode).toBe(0o600);
  });
});
