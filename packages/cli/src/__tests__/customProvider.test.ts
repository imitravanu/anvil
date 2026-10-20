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
});

