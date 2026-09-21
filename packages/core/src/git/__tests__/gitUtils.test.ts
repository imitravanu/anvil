import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execSync } from "node:child_process";
import { autoCommitMilestone, getBranchDiff } from "../gitUtils.js";

function git(cwd: string, cmd: string): string {
  return execSync(cmd, { cwd, encoding: "utf8" });
}

function initRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "anvil-git-test-"));
  git(dir, "git init");
  git(dir, "git config user.name 'Test Runner'");
  git(dir, "git config user.email 'test@example.com'");
  fs.writeFileSync(path.join(dir, "initial.txt"), "hello");
  git(dir, "git add -A && git commit -m 'initial'");
  return dir;
}

describe("autoCommitMilestone (scoped staging)", () => {
  let dir: string;

  beforeEach(() => {
    dir = initRepo();
  });

  afterEach(() => {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it("stages ONLY the given paths, leaving untracked secrets alone", async () => {
    fs.writeFileSync(path.join(dir, "feature.txt"), "new feature");
    fs.writeFileSync(path.join(dir, "leak.env"), "API_KEY=super-secret");

    const res = await autoCommitMilestone(dir, 1, "Add feature", ["feature.txt"]);
    expect(res.committed).toBe(true);

    const files = git(dir, "git show --name-only --pretty=format:")
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    expect(files).toEqual(["feature.txt"]);

    const status = git(dir, "git status --porcelain");
    expect(status).toContain("?? leak.env");
  });

  it("refuses to commit when no paths are given (fail closed, stages nothing)", async () => {
    fs.writeFileSync(path.join(dir, "feature.txt"), "new feature");

    const res = await autoCommitMilestone(dir, 1, "Add feature");
    expect(res.committed).toBe(false);
    expect(res.message).toContain("refusing to stage");

    // Nothing staged, worktree untouched.
    const staged = git(dir, "git diff --cached --name-only").trim();
    expect(staged).toBe("");
    const count = git(dir, "git rev-list --count HEAD").trim();
    expect(count).toBe("1");
  });

  it("reports clean when the scoped paths have no changes", async () => {
    const res = await autoCommitMilestone(dir, 2, "Nothing", ["initial.txt"]);
    expect(res.committed).toBe(false);
  });
});

describe("getBranchDiff", () => {
  let dir: string;

  beforeEach(() => {
    dir = initRepo();
  });

  afterEach(() => {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it("diffs against a real branch", async () => {
    const base = git(dir, "git branch --show-current").trim();
    git(dir, "git checkout -b feature");
    fs.writeFileSync(path.join(dir, "initial.txt"), "changed");
    git(dir, "git commit -am 'change'");
    const diff = await getBranchDiff(dir, base);
    expect(diff).toContain("changed");
  });

  it("throws a clean error for an unknown branch (no flag execution)", async () => {
    await expect(getBranchDiff(dir, "no-such-branch-xyz")).rejects.toThrow(
      'Failed to diff against branch "no-such-branch-xyz"'
    );
  });

  it("refuses a branch that git would read as a flag", async () => {
    // `--` only ends PATH parsing — it does not protect the revision position,
    // so `--output=<file>` used to make git WRITE a file instead of printing.
    const target = path.join(dir, "pwned.txt");
    await expect(getBranchDiff(dir, `--output=${target}`)).rejects.toThrow("unsafe branch name");
    expect(fs.readdirSync(dir).filter((f) => f.startsWith("pwned"))).toEqual([]);
  });
});
