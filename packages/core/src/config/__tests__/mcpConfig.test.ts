import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadMcpConfig, mcpConfigPath } from "../mcp.js";

describe("mcp config", () => {
  const saved = process.env.ANVIL_HOME;
  let tmp = "";
  afterEach(() => {
    if (saved === undefined) delete process.env.ANVIL_HOME;
    else process.env.ANVIL_HOME = saved;
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
    tmp = "";
  });

  function writeMcp(content: string): void {
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true }); // helper may run twice per test
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "anvil-mcp-cfg-"));
    process.env.ANVIL_HOME = tmp;
    fs.writeFileSync(path.join(tmp, "mcp.json"), content, "utf-8");
  }

  it("missing file loads empty, never throws", () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "anvil-mcp-cfg-"));
    process.env.ANVIL_HOME = tmp;
    expect(loadMcpConfig()).toEqual({ servers: [], problems: [] });
    expect(mcpConfigPath()).toBe(path.join(tmp, "mcp.json"));
  });

  it("validates good stdio/sse servers and reports every bad one (M6/25.1)", () => {
    writeMcp(
      JSON.stringify({
        servers: {
          good: { command: "node", args: ["srv.js"], env: { FOO: "1" }, timeoutMs: 5000 },
          remote: {
            transport: "sse",
            url: "https://mcp.example.com/sse",
            headers: { Authorization: "Bearer test" },
          },
          implied: { url: "http://localhost:3000/sse" },
          "Bad Id!": { command: "x" },
          nocommand: { args: [] },
          badtransport: { transport: "pigeon", command: "x" },
          plainhttp: { transport: "sse", url: "http://mcp.example.com/sse" },
          mixed: { transport: "sse", url: "https://mcp.example.com/sse", command: "node" },
          nourl: { transport: "sse" },
          badheaders: { transport: "sse", url: "https://mcp.example.com/sse", headers: { K: 42 } },
          badargs: { command: "x", args: "nope" },
          badenv: { command: "x", env: { K: 42 } },
          badtimeout: { command: "x", timeoutMs: -3 },
        },
      })
    );
    const cfg = loadMcpConfig();
    expect(cfg.servers).toEqual([
      { id: "good", transport: "stdio", command: "node", args: ["srv.js"], env: { FOO: "1" }, url: "", headers: {}, timeoutMs: 5000 },
      {
        id: "remote",
        transport: "sse",
        command: "",
        args: [],
        env: {},
        url: "https://mcp.example.com/sse",
        headers: { Authorization: "Bearer test" },
        timeoutMs: 60000,
      },
      {
        id: "implied",
        transport: "sse",
        command: "",
        args: [],
        env: {},
        url: "http://localhost:3000/sse",
        headers: {},
        timeoutMs: 60000,
      },
    ]);
    expect(cfg.problems.map((p) => p.id).sort()).toEqual(
      ["Bad Id!", "badargs", "badenv", "badtimeout", "badheaders", "badtransport", "mixed", "nocommand", "nourl", "plainhttp"].sort()
    );
    expect(cfg.problems.find((p) => p.id === "plainhttp")!.error).toContain("https");
  });

  it("corrupt JSON and non-object files report problems, never throw", () => {
    writeMcp("not json{{{");
    const bad = loadMcpConfig();
    expect(bad.servers).toEqual([]);
    expect(bad.problems).toHaveLength(1);
    expect(bad.problems[0].error).toContain("not valid JSON");
    writeMcp("[1,2,3]");
    expect(loadMcpConfig().problems).toHaveLength(1);
  });
});
