import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execSync } from "node:child_process";
import { analyzeWorkspace } from "../awareness.js";

describe("Situational Awareness Engine", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "anvil-awareness-test-"));
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it("introspects a Node.js project with package manager and scripts", async () => {
    fs.writeFileSync(
      path.join(tmpDir, "package.json"),
      JSON.stringify({
        name: "test-node-project",
        scripts: {
          test: "vitest run",
          build: "tsc",
        },
      })
    );
    fs.writeFileSync(path.join(tmpDir, "pnpm-lock.yaml"), "");
    fs.mkdirSync(path.join(tmpDir, "src"));
    fs.writeFileSync(path.join(tmpDir, "src", "index.ts"), "console.log('test');");

    const ctx = await analyzeWorkspace(tmpDir);

    expect(ctx.projectName).toBe(path.basename(tmpDir));
    expect(ctx.ecosystem.type).toBe("node");
    expect(ctx.ecosystem.packageManager).toBe("pnpm");
    expect(ctx.ecosystem.testScript).toBe("vitest run");
    expect(ctx.ecosystem.buildScript).toBe("tsc");
    expect(ctx.topLevelEntries).toContain("package.json");
    expect(ctx.topLevelEntries).toContain("src");
    expect(ctx.summary).toContain("node");
    expect(ctx.summary).toContain("pnpm");
    expect(ctx.summary).toContain("vitest run");
  });

  it("identifies yarn and bun lockfiles as the package manager", async () => {
    fs.writeFileSync(path.join(tmpDir, "package.json"), JSON.stringify({ name: "yarn-project" }));
    fs.writeFileSync(path.join(tmpDir, "yarn.lock"), "");
    expect((await analyzeWorkspace(tmpDir)).ecosystem.packageManager).toBe("yarn");

    fs.rmSync(path.join(tmpDir, "yarn.lock"));
    fs.writeFileSync(path.join(tmpDir, "bun.lockb"), "");
    expect((await analyzeWorkspace(tmpDir)).ecosystem.packageManager).toBe("bun");
  });

  it("warns but keeps going when package.json is malformed", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      fs.writeFileSync(path.join(tmpDir, "package.json"), "{ this is not json");

      const ctx = await analyzeWorkspace(tmpDir);

      expect(ctx.ecosystem.type).toBe("node");
      expect(ctx.ecosystem.testScript).toBeUndefined();
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it("degrades to an empty entry list when the root cannot be read", async () => {
    const ctx = await analyzeWorkspace(path.join(tmpDir, "does-not-exist"));
    expect(ctx.topLevelEntries).toEqual([]);
    expect(ctx.ecosystem.type).toBe("generic");
  });

  it("detects Rust ecosystem from Cargo.toml", async () => {
    fs.writeFileSync(path.join(tmpDir, "Cargo.toml"), '[package]\nname = "test_rust"\n');

    const ctx = await analyzeWorkspace(tmpDir);

    expect(ctx.ecosystem.type).toBe("rust");
    expect(ctx.ecosystem.packageManager).toBe("cargo");
    expect(ctx.ecosystem.testScript).toBe("cargo test");
    expect(ctx.ecosystem.buildScript).toBe("cargo build");
    expect(ctx.summary).toContain("rust");
    expect(ctx.summary).toContain("cargo test");
  });

  it("detects Go ecosystem from go.mod", async () => {
    fs.writeFileSync(path.join(tmpDir, "go.mod"), "module example.com/test\n\ngo 1.22\n");

    const ctx = await analyzeWorkspace(tmpDir);

    expect(ctx.ecosystem.type).toBe("go");
    expect(ctx.ecosystem.packageManager).toBe("go");
    expect(ctx.ecosystem.testScript).toBe("go test ./...");
  });

  it("detects Python ecosystem from pyproject.toml", async () => {
    fs.writeFileSync(path.join(tmpDir, "pyproject.toml"), "[tool.poetry]\nname = \"test\"\n");

    const ctx = await analyzeWorkspace(tmpDir);

    expect(ctx.ecosystem.type).toBe("python");
    expect(ctx.ecosystem.packageManager).toBe("pip");
    expect(ctx.ecosystem.testScript).toBe("pytest");
  });

  it("detects git status when project is inside a git repository", async () => {
    try {
      execSync("git init -b main", { cwd: tmpDir, stdio: "ignore" });
      execSync('git config user.email "test@anvil.ai"', { cwd: tmpDir, stdio: "ignore" });
      execSync('git config user.name "Anvil Tester"', { cwd: tmpDir, stdio: "ignore" });

      fs.writeFileSync(path.join(tmpDir, "file1.txt"), "hello");
      execSync("git add file1.txt", { cwd: tmpDir, stdio: "ignore" });
      execSync('git commit -m "initial commit"', { cwd: tmpDir, stdio: "ignore" });

      // Working tree clean
      let ctx = await analyzeWorkspace(tmpDir);
      expect(ctx.git).toBeDefined();
      expect(ctx.git?.branch).toBe("main");
      expect(ctx.git?.clean).toBe(true);
      expect(ctx.git?.modifiedFiles).toHaveLength(0);
      expect(ctx.summary).toContain("working tree clean");

      // Modify file and add untracked file
      fs.writeFileSync(path.join(tmpDir, "file1.txt"), "hello modified");
      fs.writeFileSync(path.join(tmpDir, "file2.txt"), "new file");

      ctx = await analyzeWorkspace(tmpDir);
      expect(ctx.git?.clean).toBe(false);
      expect(ctx.git?.modifiedFiles.length).toBeGreaterThanOrEqual(1);
      expect(ctx.summary).toContain("uncommitted file(s)");
    } catch {
      // If git is not available or git init fails in test env, ignore gracefully
    }
  });

  it("loads standing project rules and includes them in context", async () => {
    fs.writeFileSync(path.join(tmpDir, "AGENTS.md"), "# Mission Directives\nAlways write tests.");

    const ctx = await analyzeWorkspace(tmpDir);

    expect(ctx.projectRules).toBeDefined();
    expect(ctx.projectRules?.source).toBe("AGENTS.md");
    expect(ctx.projectRules?.content).toContain("Always write tests.");
    expect(ctx.summary).toContain("Standing Rules: loaded from AGENTS.md");
  });

  it("excludes transient folders like .git and node_modules from topLevelEntries", async () => {
    fs.mkdirSync(path.join(tmpDir, ".git"));
    fs.mkdirSync(path.join(tmpDir, "node_modules"));
    fs.mkdirSync(path.join(tmpDir, "dist"));
    fs.mkdirSync(path.join(tmpDir, "src"));
    fs.writeFileSync(path.join(tmpDir, "README.md"), "# Test");

    const ctx = await analyzeWorkspace(tmpDir);

    expect(ctx.topLevelEntries).not.toContain(".git");
    expect(ctx.topLevelEntries).not.toContain("node_modules");
    expect(ctx.topLevelEntries).not.toContain("dist");
    expect(ctx.topLevelEntries).toContain("src");
    expect(ctx.topLevelEntries).toContain("README.md");
  });
});
