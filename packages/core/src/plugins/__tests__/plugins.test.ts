import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { loadPlugins, pluginSystemPrompts } from "../loader.js";
import { pluginToolDefinitions, renderCommand, buildArgv, registerPluginExecutors } from "../registry.js";
import { executeTool, describeToolInput } from "../../tools/index.js";

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

describe("buildArgv", () => {
  it("fills every {input} placeholder and keeps the payload in ONE argv element", () => {
    const tool = { name: "t", description: "d", command: "node", args: ["-e", "{input}", "--flag={input}"] };
    const argv = buildArgv(tool, { x: "; rm -rf ~" });
    expect(argv[0]).toBe("-e");
    // The whole JSON lands in element 1, metacharacters and all — there is no
    // shell between here and the process, so they can never be re-parsed.
    expect(argv[1]).toBe('{"x":"; rm -rf ~"}');
    expect(argv[2]).toBe('--flag={"x":"; rm -rf ~"}');
  });
});

describe("plugin argv execution", () => {
  let dir = "";
  let root = "";
  afterEach(() => {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
    if (root) fs.rmSync(root, { recursive: true, force: true });
    dir = "";
    root = "";
  });

  it("rejects malformed args as a loader problem, never as a runnable tool", () => {
    dir = makePluginsDir({
      badargs: {
        name: "badargs",
        version: "1.0.0",
        tools: [{ name: "t", description: "d", command: "node", args: ["ok", 42] }],
      },
    });
    const { plugins, problems } = loadPlugins(dir);
    expect(plugins).toEqual([]);
    expect(problems[0].error).toMatch(/args/i);
  });

  it("passes model-controlled input to the process as data, not as shell", async () => {
    dir = makePluginsDir({
      pwn: {
        name: "pwn",
        version: "1.0.0",
        tools: [
          {
            name: "echo",
            description: "Echo the JSON payload",
            command: "node",
            // -e evaluates the SCRIPT (a constant), then writes argv[1] — the
            // model payload — back. If anything re-parsed it as a shell string,
            // the `touch` below would run and the marker file would appear.
            args: ["-e", "process.stdout.write(process.argv[1])", "{input}"],
          },
        ],
      },
    });
    root = fs.mkdtempSync(path.join(os.tmpdir(), "anvil-plugin-root-"));
    const marker = path.join(root, "pwned.txt");
    const { plugins, problems } = loadPlugins(dir);
    expect(problems).toEqual([]);
    registerPluginExecutors(plugins);

    const payload = { x: "; touch " + marker };
    const ctx = { projectRoot: root, signal: new AbortController().signal };
    // The permission prompt shows the REAL command for the argv form, so
    // consent is informed — not a bare JSON blob.
    const preview = await describeToolInput("plugin_pwn__echo", payload, ctx);
    expect(preview.startsWith("node -e ")).toBe(true);
    expect(preview).toContain(JSON.stringify(payload));
    const result = await executeTool("plugin_pwn__echo", payload, ctx);
    expect(result.isError).toBe(false);
    // The payload came back verbatim as DATA...
    expect((result.output as { stdout: string }).stdout).toBe(JSON.stringify(payload));
    // ...and nothing executed it.
    expect(fs.existsSync(marker)).toBe(false);
  });
});
