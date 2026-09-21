import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { guardedInit } from "../init.js";

/**
 * Phase 26.4 acceptance: provisioning is verified in a throwaway NON-Anvil
 * repo, and the hook's acceptance is a REAL blocked commit — not a unit test
 * of the script text. The hook is dependency-free by design, so the whole
 * matrix runs with plain node + git.
 */

const AS_ANY = "const x = input as an" + "y;";
const BARE_EXCEPT = "try:\n    risky()\nexce" + "pt:\n    pass\n";

interface Repo {
  dir: string;
  git: (args: string[], opts?: { env?: Record<string, string> }) => string;
  write: (rel: string, content: string) => void;
}

function gitEnv(): Record<string, string> {
  return {
    GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.com",
    GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.com",
  };
}

function makeRepo(): Repo {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "anvil-guarded-26-4-"));
  execFileSync("git", ["init", "-q"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "t@example.com"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "t"], { cwd: dir });
  return {
    dir,
    git: (args, opts) =>
      execFileSync("git", args, {
        cwd: dir,
        encoding: "utf8",
        env: { ...process.env, ...gitEnv(), ...opts?.env },
      }),
    write: (rel, content) => {
      const abs = path.join(dir, rel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, content);
    },
  };
}

const repos: Repo[] = [];
const makeTrackedRepo = (): Repo => {
  const r = makeRepo();
  repos.push(r);
  return r;
};

afterEach(() => {
  for (const r of repos) fs.rmSync(r.dir, { recursive: true, force: true });
  repos.length = 0;
});

function commitAll(repo: Repo, message: string, env?: Record<string, string>): void {
  repo.git(["add", "-A"]);
  repo.git(["commit", "-m", message], { env });
}

/** Count commits; 0 when the repo has none (rev-list needs a HEAD to resolve). */
function commitCount(repo: Repo): number {
  try {
    return Number(repo.git(["rev-list", "HEAD", "--count"]).trim());
  } catch {
    return 0;
  }
}

describe("26.4 guarded init — provisioning matrix (throwaway non-Anvil repos)", () => {
  const languages = ["typescript", "python", "rust", "go"] as const;

  for (const lang of languages) {
    it(`provisions ${lang}: AGENTS.md + .anvil/rules + executable hook + hooksPath`, () => {
      const repo = makeTrackedRepo();
      const result = guardedInit(repo.dir, lang);

      expect(result.created).toContain("AGENTS.md");
      expect(result.created).toContain(".anvil/rules");
      expect(result.created).toContain(".githooks/pre-commit");
      expect(result.created).toContain("core.hooksPath (git config)");

      // Language tail actually tailored.
      expect(fs.readFileSync(path.join(repo.dir, "AGENTS.md"), "utf8")).toContain(`Language: ${lang}`);
      // Rules block parses as the guardian:rules format (entries present).
      const rules = fs.readFileSync(path.join(repo.dir, ".anvil/rules"), "utf8");
      expect(rules).toContain("guardian:rules");
      // The hook must be executable — git execs it via shebang.
      const mode = fs.statSync(path.join(repo.dir, ".githooks/pre-commit")).mode & 0o777;
      expect(mode & 0o111).not.toBe(0);
      // hooksPath is set under [core] in the repo's own config.
      const config = fs.readFileSync(path.join(repo.dir, ".git", "config"), "utf8");
      expect(config).toContain("hooksPath = .githooks");
      // A bare non-Anvil root must not be mistaken for the Anvil monorepo.
      expect(rules).not.toContain("anvil/core");
    });
  }

  it("never overwrites existing files and keeps an existing hooksPath", () => {
    const repo = makeTrackedRepo();
    repo.write(".githooks/pre-commit", "#!/bin/sh\nexit 0\n");
    repo.git(["config", "core.hooksPath", ".githooks"]);

    const result = guardedInit(repo.dir, "go");

    expect(result.skipped).toContain(".githooks/pre-commit");
    expect(result.skipped).toContain("core.hooksPath (already configured)");
    // The operator's own hook survived byte-for-byte.
    expect(fs.readFileSync(path.join(repo.dir, ".githooks/pre-commit"), "utf8")).toContain("#!/bin/sh");
    // The rules block was still provisioned (it was not pre-existing).
    expect(fs.existsSync(path.join(repo.dir, ".anvil/rules"))).toBe(true);
  });
});

describe("26.4 guarded init — hook blocks planted slop, allows clean commits", () => {
  it("blocks a planted universal-slop commit with a non-zero exit", () => {
    const repo = makeTrackedRepo();
    guardedInit(repo.dir, "typescript");

    repo.write("src/slop.ts", `${AS_ANY}\n`);
    const blockedErr = "commit blocked";
    expect(() => commitAll(repo, "planted slop")).toThrow(blockedErr);
    // The commit must NOT exist.
    expect(commitCount(repo)).toBe(0);
    // The block explains itself.
    let stderr = "";
    try {
      commitAll(repo, "planted slop again");
    } catch (err: unknown) {
      stderr = String((err as { stderr?: string }).stderr ?? "");
    }
    expect(stderr).toContain("anvil-guardian");
    expect(stderr).toContain("no-as-any");
  });

  it("allows a clean commit end-to-end", () => {
    const repo = makeTrackedRepo();
    guardedInit(repo.dir, "typescript");

    repo.write("README.md", "# clean project\n\nAll good here.\n");
    expect(() => commitAll(repo, "clean commit")).not.toThrow();
    expect(commitCount(repo)).toBe(1);
  });

  it("enforces the project's own guardian:rules (python tail) on staged code", () => {
    const repo = makeTrackedRepo();
    guardedInit(repo.dir, "python");

    repo.write("server.py", BARE_EXCEPT);
    expect(() => commitAll(repo, "bare except")).toThrow();
    expect(commitCount(repo)).toBe(0);
  });

  it("stays silent on an empty commit (nothing staged)", () => {
    const repo = makeTrackedRepo();
    guardedInit(repo.dir, "typescript");
    // Empty commit: no changes staged, the hook must allow it.
    expect(() => repo.git(["commit", "--allow-empty", "-m", "empty"])).not.toThrow();
  });
});

describe("26.4 — no-Anvil degradation", () => {
  it("hook works with NO Anvil installation: plain node, no deps, honest failure", () => {
    const repo = makeTrackedRepo();
    guardedInit(repo.dir, "typescript");

    // The script must not reference Anvil packages — a repo without @anvil
    // installed still gets full enforcement.
    const hook = fs.readFileSync(path.join(repo.dir, ".githooks/pre-commit"), "utf8");
    expect(hook).not.toMatch(/require\("@anvil/);
    expect(hook).not.toMatch(/from "@anvil/);

    // The git-missing branch reports the recovery hint rather than failing
    // cryptically. Simulated with an isolated PATH dir holding ONLY a node
    // symlink: node (and therefore the script) resolves, git does not.
    repo.write("clean.txt", "no git needed for this test of the script itself\n");
    repo.git(["add", "-A"]);
    const isoBin = path.join(repo.dir, "isopath");
    fs.mkdirSync(isoBin);
    fs.symlinkSync(process.execPath, path.join(isoBin, "node"));
    let stderr = "";
    try {
      execFileSync(path.join(isoBin, "node"), [path.join(repo.dir, ".githooks", "pre-commit")], {
        cwd: repo.dir,
        encoding: "utf8",
        env: { ...process.env, PATH: isoBin },
      });
    } catch (err: unknown) {
      stderr = String((err as { stderr?: string }).stderr ?? "");
    }
    expect(stderr).toContain("git is not available");
    expect(stderr).toContain("--no-verify");
  });
});
