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

  it("validates a good server and reports every bad one (M6)", () => {
    writeMcp(
      JSON.stringify({
        servers: {
          good: { command: "node", args: ["srv.js"], env: { FOO: "1" }, timeoutMs: 5000 },
          "Bad Id!": { command: "x" },
          nocommand: { args: [] },
          remote: { url: "https://mcp.example.com" },
          badargs: { command: "x", args: "nope" },
          badenv: { command: "x", env: { K: 42 } },
          badtimeout: { command: "x", timeoutMs: -3 },
        },
      })
    );
    const cfg = loadMcpConfig();
    expect(cfg.servers).toEqual([
      { id: "good", command: "node", args: ["srv.js"], env: { FOO: "1" }, timeoutMs: 5000 },
    ]);
    expect(cfg.problems.map((p) => p.id).sort()).toEqual(
      ["Bad Id!", "badargs", "badenv", "badtimeout", "nocommand", "remote"].sort()
    );
    expect(cfg.problems.find((p) => p.id === "remote")!.error).toContain("stdio-only");
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
