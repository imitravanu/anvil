import { execSync, spawnSync } from "node:child_process";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { executeTool } from "../index.js";
import { isBlockedCommand, runCommandTimeoutMs } from "../bash.js";
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

  it("does not expose arbitrary parent environment variables to commands", async () => {
    process.env.ANVIL_TEST_SECRET = "should-not-leak";
    const result = await executeTool("run_command", { command: "printf '%s' \"$ANVIL_TEST_SECRET\"" }, ctx);
    expect((result.output as { stdout: string }).stdout).toBe("");
    delete process.env.ANVIL_TEST_SECRET;
  });
});

describe("run_command timeout override (ANVIL_RUN_COMMAND_TIMEOUT_MS)", () => {
  const KEY = "ANVIL_RUN_COMMAND_TIMEOUT_MS";
  const saved = process.env[KEY];

  afterEach(() => {
    if (saved === undefined) delete process.env[KEY];
    else process.env[KEY] = saved;
  });

  it("defaults to the built-in when unset or non-numeric", () => {
    delete process.env[KEY];
    expect(runCommandTimeoutMs()).toBe(120_000);
    process.env[KEY] = "not-a-number";
    expect(runCommandTimeoutMs()).toBe(120_000);
  });

  it("clamps hostile values into [1s, 10m]", () => {
    process.env[KEY] = "0";
    expect(runCommandTimeoutMs()).toBe(1_000);
    process.env[KEY] = "999999999";
    expect(runCommandTimeoutMs()).toBe(600_000);
  });

  it("honors a valid override", () => {
    process.env[KEY] = "45000";
    expect(runCommandTimeoutMs()).toBe(45_000);
  });
});

describe("run_command destructive-command guard", () => {
  it("blocks filesystem-root / home wipes, chained or direct", () => {
    for (const cmd of [
      "rm -rf /",
      "rm -rf /*",
      "rm -rf ~",
      "rm -rf $HOME",
      "rm -rf \"$HOME\"",
      "rm -rf '~'",
      "echo hi && rm -rf \"$HOME\"",
      "echo $(rm -rf ~)",
      "echo `rm -rf ~`",
      "rm -fr /",
      "rm -r -f /",
      "rm --recursive --force /",
      "npm run build && rm -rf ~",
      "echo hi; rm -rf /",
    ]) {
      expect(isBlockedCommand(cmd), cmd).not.toBeNull();
    }
  });

  it("blocks fork bombs, mkfs, raw device writes, root chmod", () => {
    expect(isBlockedCommand(":(){ :|:& };:")).not.toBeNull();
    expect(isBlockedCommand("mkfs.ext4 /dev/sda1")).not.toBeNull();
    expect(isBlockedCommand("dd if=/dev/zero of=/dev/sda bs=1M")).not.toBeNull();
    expect(isBlockedCommand("echo x > /dev/sda")).not.toBeNull();
    expect(isBlockedCommand("chmod -R 777 /")).not.toBeNull();
  });

  it("allows ordinary commands including project-local rm -rf", () => {
    for (const cmd of [
      "echo hello",
      "npm run build",
      "rm -rf ./build",
      "rm -rf dist",
      "rm file.txt",
      "grep -r foo .",
      "dd if=input of=output bs=1M",
    ]) {
      expect(isBlockedCommand(cmd), cmd).toBeNull();
    }
  });

  it("refuses without spawning: no side effects, isError result", async () => {
    const marker = path.join(root, "should-not-exist");
    const result = await executeTool(
      "run_command",
      { command: `touch ${marker} && rm -rf /` },
      ctx
    );
    expect(result.isError).toBe(true);
    expect(result.summary).toContain("Blocked");
    expect((result.output as { blocked: string }).blocked).toContain("filesystem root");
    expect(await fs.stat(marker).then(() => true).catch(() => false)).toBe(false);
  });

  it("still executes a project-local recursive delete", async () => {
    const dir = path.join(root, "build-out");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "f.txt"), "x");
    const result = await executeTool("run_command", { command: "rm -rf ./build-out" }, ctx);
    expect(result.isError).toBe(false);
    expect(await fs.stat(dir).then(() => true).catch(() => false)).toBe(false);
  });
});

describe("run_command read-only safe-list", () => {
  it("positively recognizes plain read-only commands", async () => {
    const { isReadOnlyCommand } = await import("../bash.js");
    for (const cmd of [
      "ls", "ls -la", "pwd", "cat file.txt", "head -n 5 log.txt", "wc -l src/index.ts",
      "git status", "git log --oneline", "git diff", "node --version", "npm ls",
      "python3 --version", "echo hello world", "date", "uname -a",
    ]) {
      expect(isReadOnlyCommand(cmd, root), cmd).toBe(true);
    }
  });

  it("gates everything not positively read-only", async () => {
    const { isReadOnlyCommand } = await import("../bash.js");
    for (const cmd of [
      "rm file.txt", "mv a b", "git push", "git commit -m x", "git branch feat",
      "npm run build", "npm test", "python3 -c 'import os'", "npx whatever",
      "cat a > b", "ls; rm -rf /", "echo hi && evil", "cat `cat f`", "echo $HOME",
      "find . -delete", "ls *.txt", "", "  ",
    ]) {
      expect(isReadOnlyCommand(cmd, root), cmd).toBe(false);
    }
  });

  it("contains file-reader arguments to the project root", async () => {
    const { isReadOnlyCommand } = await import("../bash.js");
    // Reading host files with no prompt must be impossible: the equivalent
    // read_file is path-contained, and the safe-list must not bypass it.
    for (const cmd of [
      "cat /etc/passwd", "cat ~/.ssh/id_rsa", "head -20 /etc/hosts",
      "tail -5 /var/log/syslog", "stat /etc/shadow", "du /usr", "file /bin/bash",
      "cat ../outside.txt", "wc -l ../../etc/passwd",
      "ls /etc", "ls ~/.ssh", "ls ../outside",
    ]) {
      expect(isReadOnlyCommand(cmd, root), cmd).toBe(false);
    }
    expect(isReadOnlyCommand("cat ./file.txt", root)).toBe(true);
    expect(isReadOnlyCommand("ls ./src", root)).toBe(true);
    expect(isReadOnlyCommand("cat /etc/passwd")).toBe(false); // no root: fail closed
    expect(isReadOnlyCommand("ls /etc")).toBe(false); // no root: fail closed
  });
});
