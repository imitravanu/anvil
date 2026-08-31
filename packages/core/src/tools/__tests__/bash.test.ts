import { execSync, spawnSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { executeTool } from "../index.js";
import type { ToolContext } from "../types.js";

let root: string;
let ctx: ToolContext;
const never = new AbortController().signal;

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "anvil-bash-"));
  ctx = { projectRoot: root, signal: never };
});
afterAll(() => fs.rm(root, { recursive: true, force: true }));

function sleep30Running(): boolean {
  try {
    // [s]leep avoids matching this grep itself
    execSync('ps -ax -o command= | grep "[s]leep 30"', { stdio: "pipe" });
    return true;
  } catch {
    return false; // grep exits 1 when nothing matches
  }
}

describe("run_command", () => {
  it("captures stdout and a zero exit code", async () => {
    const result = await executeTool("run_command", { command: "echo hello-anvil" }, ctx);
    expect(result.isError).toBe(false);
    expect((result.output as { stdout: string }).stdout.trim()).toBe("hello-anvil");
    expect(result.summary).toContain("exit 0");
  });

  it("captures stderr and marks non-zero exits as errors", async () => {
    const result = await executeTool(
      "run_command",
      { command: "echo boom >&2; exit 3" },
      ctx
    );
    expect(result.isError).toBe(true);
    expect((result.output as { stderr: string }).stderr.trim()).toBe("boom");
    expect((result.output as { exitCode: number }).exitCode).toBe(3);
  });

  it("kills the child process when ctx.signal aborts", async () => {
    const controller = new AbortController();
    const abortingCtx: ToolContext = { projectRoot: root, signal: controller.signal };
    const pending = executeTool("run_command", { command: "sleep 30" }, abortingCtx);
    await new Promise((r) => setTimeout(r, 300)); // let the child actually start
    controller.abort();
    const result = await pending;
    expect((result.output as { aborted: boolean }).aborted).toBe(true);
    // give the OS a beat to reap the process, then verify it is really gone
    await new Promise((r) => setTimeout(r, 200));
    expect(sleep30Running()).toBe(false);
  }, 15000);

  it("refuses nothing about content but still routes cwd through the project root", async () => {
    const result = await executeTool("run_command", { command: "pwd" }, ctx);
    expect((result.output as { stdout: string }).stdout.trim()).toBe(root);
  });
});
