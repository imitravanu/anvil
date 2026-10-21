import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { createServer, type Server } from "node:http";
import { fileURLToPath } from "node:url";

let root: string;
let server: Server | undefined;
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), "anvil-custom-cli-")); });
afterEach(async () => {
  if (server) {
    server.closeAllConnections();
    await new Promise<void>(resolve => server!.close(() => resolve()));
    server = undefined;
  }
  fs.rmSync(root, { recursive: true, force: true });
});
const entry = fileURLToPath(new URL("../index.tsx", import.meta.url));
const loader = import.meta.resolve("tsx");
function run(args: string[], env: Record<string, string> = {}) {
  return new Promise<{ code: number | string; stdout: string; stderr: string }>(resolve => {
    const child = execFile(process.execPath, ["--import", loader, entry, ...args], {
      cwd: root, timeout: 8000,
      env: { PATH: process.env.PATH, ANVIL_HOME: root, ANVIL_NO_ALT_SCREEN: "1", ...env },
    }, (err, stdout, stderr) => resolve({ code: err?.code ?? 0, stdout, stderr }));
    child.stdin?.end();
  });
}

describe("custom provider CLI integration", () => {
  it("boots from saved configuration and executes a streamed tool round-trip", async () => {
    const requests: Array<Record<string, any>> = [];
    const headers: Array<Record<string, unknown>> = [];
    server = createServer(async (req, res) => {
      let data = "";
      for await (const chunk of req) data += chunk;
      requests.push(JSON.parse(data));
      headers.push(req.headers);
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      const delta = requests.length === 1
        ? { tool_calls: [{ index: 0, id: "read1", function: { name: "read_file", arguments: '{"path":"notes.txt"}' } }] }
        : { content: "custom endpoint reached" };
      res.end(`data: ${JSON.stringify({ choices: [{ delta, finish_reason: requests.length === 1 ? "tool_calls" : "stop" }] })}\n\ndata: [DONE]\n\n`);
    });
    await new Promise<void>(resolve => server!.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("fixture server unavailable");
    fs.writeFileSync(path.join(root, "notes.txt"), "fixture-content-42");
    fs.writeFileSync(path.join(root, "providers.json"), JSON.stringify([{
      id: "custom:fixture", name: "Fixture", baseUrl: `http://127.0.0.1:${address.port}/v1`,
      auth: "bearer", apiKeyEnv: "CUSTOM_FIXTURE_KEY", streamUsage: false,
      models: [{ id: "fixture-model", contextWindow: 32768 }],
    }]));
    const result = await run(["--provider", "custom:fixture", "-p", "Read notes.txt", "--raw", "--no-mcp"], { CUSTOM_FIXTURE_KEY: "fixture-only-key" });
    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toContain("custom endpoint reached");
    expect(result.stderr).not.toContain("fixture-only-key");
    expect(requests).toHaveLength(2);
    expect(requests[0].model).toBe("fixture-model");
    expect(requests[0]).not.toHaveProperty("stream_options");
    expect(requests[1].messages.some((message: Record<string, any>) => message.role === "tool" && message.content.includes("fixture-content-42"))).toBe(true);
    expect(headers[0]).toHaveProperty("authorization", "Bearer fixture-only-key");
  }, 10000);

  it("reports an unknown provider instead of entering a non-TTY setup flow", async () => {
    const result = await run(["--provider", "custom:missing", "--no-mcp", "-p", "hello"]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('Unknown provider "custom:missing"');
    expect(result.stderr).not.toContain("stdin is not a TTY");
  }, 10000);

  it("keeps help available when custom configuration is malformed", async () => {
    fs.writeFileSync(path.join(root, "providers.json"), "not-json");
    const result = await run(["--help"]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("Custom providers:");
  }, 10000);

  it("manages custom providers via CLI (list, add, test, remove)", async () => {
    let listRes = await run(["provider", "list"]);
    expect(listRes.code).toBe(0);
    expect(listRes.stdout).toContain("No custom providers configured");

    server = createServer((req, res) => {
      if (req.url === "/v1/models") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ data: [{ id: "mock-model-1" }, { id: "mock-model-2" }] }));
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("fixture server unavailable");
    const baseUrl = `http://127.0.0.1:${address.port}/v1`;

    const addRes = await run([
      "provider",
      "add",
      "mygateway",
      "--url",
      baseUrl,
      "--name",
      "My Custom Gateway",
      "--protocol",
      "openai-responses",
      "--key",
      "test-secret",
    ]);
    expect(addRes.code).toBe(0);
    expect(addRes.stdout).toContain('Configured custom provider "custom:mygateway"');

    listRes = await run(["provider", "list"]);
    expect(listRes.code).toBe(0);
    expect(listRes.stdout).toContain("custom:mygateway");
    expect(listRes.stdout).toContain("openai-responses");
    expect(listRes.stdout).toContain("My Custom Gateway");

    const testRes = await run(["provider", "test", "mygateway"]);
    expect(testRes.code).toBe(0);
    expect(testRes.stdout).toContain("Connectivity probe succeeded");
    expect(testRes.stdout).toContain("mock-model-1");

    const removeRes = await run(["provider", "remove", "mygateway"]);
    expect(removeRes.code).toBe(0);
    expect(removeRes.stdout).toContain('Removed custom provider "custom:mygateway"');

    listRes = await run(["provider", "list"]);
    expect(listRes.code).toBe(0);
    expect(listRes.stdout).toContain("No custom providers configured");
  }, 15000);

  it("supports ad-hoc --base-url without prior configuration", async () => {
    server = createServer(async (req, res) => {
      let data = "";
      for await (const chunk of req) data += chunk;
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.end(`data: ${JSON.stringify({ choices: [{ delta: { content: "adhoc response" }, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`);
    });
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("fixture server unavailable");
    const baseUrl = `http://127.0.0.1:${address.port}/v1`;

    const res = await run(["--base-url", baseUrl, "--model", "custom-model", "-p", "hello", "--raw", "--no-mcp"]);
    expect(res.code).toBe(0);
    expect(res.stdout).toContain("adhoc response");
  }, 10000);

  it("discovers models on startup and uses a real ID without persisting the catalog", async () => {
    const urls: string[] = [];
    server = createServer(async (req, res) => {
      urls.push(req.url!);
      if (req.url === "/v1/models") {
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ data: [{ id: "discovered-cli-model" }] }));
        return;
      }
      let body = ""; for await (const chunk of req) body += chunk;
      expect(JSON.parse(body).model).toBe("discovered-cli-model");
      res.setHeader("Content-Type", "text/event-stream");
      res.end(`data: ${JSON.stringify({ choices: [{ delta: { content: "discovery boot works" }, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`);
    });
    await new Promise<void>(resolve => server!.listen(0, "127.0.0.1", resolve));
    const address = server.address(); if (!address || typeof address === "string") throw new Error("fixture unavailable");
    const config = [{ id: "custom:dynamic", name: "Dynamic", baseUrl: `http://127.0.0.1:${address.port}/v1`, auth: "none", models: [] }];
    const before = JSON.stringify(config);
    fs.writeFileSync(path.join(root, "providers.json"), before);
    const result = await run(["--provider", "custom:dynamic", "-p", "hello", "--raw", "--no-mcp"]);
    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toContain("discovery boot works");
    expect(urls).toEqual(["/v1/models", "/v1/chat/completions"]);
    expect(fs.readFileSync(path.join(root, "providers.json"), "utf8")).toBe(before);
  }, 10000);

  it.each([undefined, "openai"])("honors --base-url and an environment key with provider %s", async provider => {
    server = createServer(async (req, res) => {
      expect(req.url).toBe("/v1/chat/completions");
      expect(req.headers.authorization).toBe("Bearer ephemeral-key");
      res.setHeader("Content-Type", "text/event-stream");
      res.end(`data: ${JSON.stringify({ choices: [{ delta: { content: "override reached" }, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`);
    });
    await new Promise<void>(resolve => server!.listen(0, "127.0.0.1", resolve));
    const address = server.address(); if (!address || typeof address === "string") throw new Error("fixture unavailable");
    const result = await run([...(provider ? ["--provider", provider] : []), "--base-url", `http://127.0.0.1:${address.port}/v1`, "--api-key-env", "FIXTURE_EPHEMERAL_KEY", "--model", "fixture", "-p", "hello", "--raw", "--no-mcp"], { FIXTURE_EPHEMERAL_KEY: "ephemeral-key" });
    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toContain("override reached");
    expect(result.stderr).not.toContain("ephemeral-key");
    expect(fs.existsSync(path.join(root, "providers.json"))).toBe(false);
    expect(fs.existsSync(path.join(root, "provider-keys.json"))).toBe(false);
    expect(fs.existsSync(path.join(root, "settings.json"))).toBe(false);
  }, 10000);

  it("fails clearly when discovery has no models, instead of sending a fabricated default", async () => {
    server = createServer((req, res) => {
      expect(req.url).toBe("/v1/models");
      res.setHeader("Content-Type", "application/json"); res.end('{"data":[]}');
    });
    await new Promise<void>(resolve => server!.listen(0, "127.0.0.1", resolve));
    const address = server.address(); if (!address || typeof address === "string") throw new Error("fixture unavailable");
    const result = await run(["--base-url", `http://127.0.0.1:${address.port}/v1`, "-p", "hello", "--no-mcp"]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("No models available");
    expect(result.stderr).toContain("--model");
  }, 10000);

  it("rejects malformed management flags without saving a provider", async () => {
    const result = await run(["provider", "add", "bad", "--url"]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("Missing value for --url");
    expect(fs.existsSync(path.join(root, "providers.json"))).toBe(false);
    const typo = await run(["provider", "add", "bad", "--url", "https://fixture.invalid/v1", "--keey", "sensitive-value"]);
    expect(typo.code).toBe(1);
    expect(typo.stderr).not.toContain("sensitive-value");
    expect(fs.existsSync(path.join(root, "providers.json"))).toBe(false);
  }, 10000);

  it("rejects an explicit provider typo even when an ad-hoc URL is supplied", async () => {
    const result = await run(["--provider", "anthrpic", "--base-url", "http://127.0.0.1:1/v1", "--model", "fixture", "-p", "hello", "--no-mcp"]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('Unknown provider "anthrpic"');
  }, 10000);
});

