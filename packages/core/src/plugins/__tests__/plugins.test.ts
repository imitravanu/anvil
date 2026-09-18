import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { loadPlugins, pluginSystemPrompts } from "../loader.js";
import { pluginToolDefinitions, renderCommand } from "../registry.js";

function makePluginsDir(entries: Record<string, unknown>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "anvil-plugins-"));
  for (const [name, manifest] of Object.entries(entries)) {
    const pluginDir = path.join(dir, name);
    fs.mkdirSync(pluginDir, { recursive: true });
    fs.writeFileSync(path.join(pluginDir, "plugin.json"), JSON.stringify(manifest));
  }
  return dir;
}

describe("loadPlugins", () => {
  let dir = "";
  afterEach(() => {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
    dir = "";
  });

  it("returns empty for a missing dir", () => {
    const { plugins, problems } = loadPlugins(path.join(os.tmpdir(), "anvil-no-such-dir-xyz"));
    expect(plugins).toEqual([]);
    expect(problems).toEqual([]);
  });

  it("loads a valid plugin", () => {
    dir = makePluginsDir({
      hello: { name: "hello", version: "1.0.0", tools: [{ name: "greet", description: "Say hi", command: "echo {input}" }] },
    });
    const { plugins, problems } = loadPlugins(dir);
    expect(problems).toEqual([]);
    expect(plugins).toHaveLength(1);
    expect(plugins[0].manifest.name).toBe("hello");
    expect(plugins[0].enabled).toBe(true);
  });

  it("reports invalid manifests as problems", () => {
    dir = makePluginsDir({
      bad: { name: "BAD NAME!", version: "" },
    });
    const { plugins, problems } = loadPlugins(dir);
    expect(plugins).toEqual([]);
    expect(problems).toHaveLength(1);
  });

  it("respects enabled:false", () => {
    dir = makePluginsDir({
      quiet: { name: "quiet", version: "1.0.0", enabled: false },
    });
    const { plugins } = loadPlugins(dir);
    expect(plugins[0].enabled).toBe(false);
    expect(pluginToolDefinitions(plugins[0])).toEqual([]);
  });

  it("builds tool definitions with plugin prefix", () => {
    dir = makePluginsDir({
      hello: { name: "hello", version: "1.0.0", tools: [{ name: "greet", description: "Say hi", command: "echo hi" }] },
    });
    const { plugins } = loadPlugins(dir);
    const defs = pluginToolDefinitions(plugins[0]);
    expect(defs[0].name).toBe("plugin_hello__greet");
    expect(defs[0].mutating).toBe(true);
  });

  it("collects system prompts from enabled plugins only", () => {
    dir = makePluginsDir({
      a: { name: "a", version: "1.0.0", systemPrompt: "Be terse." },
      b: { name: "b", version: "1.0.0", enabled: false, systemPrompt: "Be verbose." },
    });
    const { plugins } = loadPlugins(dir);
    expect(pluginSystemPrompts(plugins)).toEqual(["Be terse."]);
  });
});

describe("renderCommand", () => {
  it("replaces every {input} placeholder with the JSON of the input object", () => {
    expect(renderCommand("printf %s {input}", { hello: "world" })).toBe('printf %s {"hello":"world"}');
    expect(renderCommand("echo {input} | case {input}", 1)).toBe('echo 1 | case 1');
  });

  it("does not interpret $& / $` / $' inside the JSON as replacement references (A3)", () => {
    // Literal String.replace would resolve `$&` in the replacement to the whole
    // matched text `{input}`, corrupting the rendered command. The function
    // form keeps model-controlled input verbatim.
    const rendered = renderCommand("printf %s {input}", "${HOME} $& and more");
    expect(rendered).toContain("$&");
    expect(rendered).toContain("${HOME}");
    expect(rendered).not.toContain("{input}");
  });
});
