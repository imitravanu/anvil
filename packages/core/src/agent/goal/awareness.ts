import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { SituationalContext, GitContext, EcosystemContext } from "./types.js";
import { loadProjectRules } from "../../config/rules.js";
import { EXCLUDED_DIRS } from "../../tools/paths.js";
import { getErrorMessage } from "../../errors.js";
import { log } from "../../logger.js";


/**
 * Gather git repository status if inside a git working tree.
 */
function inspectGit(projectRoot: string): GitContext | undefined {
  try {
    // A repo with zero commits has no resolvable HEAD; rev-parse --abbrev-ref
    // fails there, which read as "no git" in the header. Probe the work tree
    // instead and use branch --show-current (works on unborn branches).
    execSync("git rev-parse --is-inside-work-tree", {
      cwd: projectRoot,
      timeout: 2000,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "ignore"],
    });

    const branch = execSync("git branch --show-current", {
      cwd: projectRoot,
      timeout: 2000,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "ignore"],
    }).trim();

    const porcelain = execSync("git status --porcelain", {
      cwd: projectRoot,
      timeout: 2000,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "ignore"],
    }).trim();

    const lines = porcelain ? porcelain.split("\n").map((l) => l.trim()).filter(Boolean) : [];
    const modifiedFiles = lines.map((l) => l.slice(3).trim());

    return {
      branch: branch || "HEAD",
      clean: lines.length === 0,
      modifiedFiles,
    };
  } catch {
    return undefined;
  }
}

/**
 * Detect runtime ecosystem, package manager, and build/test commands.
 */
function inspectEcosystem(projectRoot: string): EcosystemContext {
  const pkgJsonPath = path.join(projectRoot, "package.json");
  if (fs.existsSync(pkgJsonPath)) {
    let pkg: { scripts?: Record<string, string> } = {};
    try {
      pkg = JSON.parse(fs.readFileSync(pkgJsonPath, "utf8"));
    } catch (err) {
      log.warn(`[awareness] Warning: malformed package.json at ${pkgJsonPath}: ${getErrorMessage(err)}`);
    }

    let packageManager = "npm";
    if (fs.existsSync(path.join(projectRoot, "pnpm-lock.yaml"))) {
      packageManager = "pnpm";
    } else if (fs.existsSync(path.join(projectRoot, "yarn.lock"))) {
      packageManager = "yarn";
    } else if (fs.existsSync(path.join(projectRoot, "bun.lockb"))) {
      packageManager = "bun";
    }

    return {
      type: "node",
      packageManager,
      testScript: pkg.scripts?.test,
      buildScript: pkg.scripts?.build,
    };
  }

  if (fs.existsSync(path.join(projectRoot, "Cargo.toml"))) {
    return {
      type: "rust",
      packageManager: "cargo",
      testScript: "cargo test",
      buildScript: "cargo build",
    };
  }

  if (fs.existsSync(path.join(projectRoot, "go.mod"))) {
    return {
      type: "go",
      packageManager: "go",
      testScript: "go test ./...",
      buildScript: "go build ./...",
    };
  }

  if (
    fs.existsSync(path.join(projectRoot, "pyproject.toml")) ||
    fs.existsSync(path.join(projectRoot, "setup.py")) ||
    fs.existsSync(path.join(projectRoot, "requirements.txt"))
  ) {
    return {
      type: "python",
      packageManager: "pip",
      testScript: "pytest",
    };
  }

  return {
    type: "generic",
  };
}

/**
 * Introspect the workspace to construct an authoritative SituationalContext.
 */
export async function analyzeWorkspace(projectRoot: string): Promise<SituationalContext> {
  const projectName = path.basename(projectRoot);
  const git = inspectGit(projectRoot);
  const ecosystem = inspectEcosystem(projectRoot);
  const rules = loadProjectRules(projectRoot);

  let topLevelEntries: string[] = [];
  try {
    const entries = await fs.promises.readdir(projectRoot);
    topLevelEntries = entries.filter((name) => !EXCLUDED_DIRS.has(name));
  } catch (_err) {
    topLevelEntries = [];
  }

  const parts: string[] = [
    `Project: ${projectName} (${ecosystem.type})`,
  ];

  if (ecosystem.packageManager) {
    parts.push(`Package Manager: ${ecosystem.packageManager}`);
  }
  if (ecosystem.testScript) {
    parts.push(`Test Command: ${ecosystem.testScript}`);
  }
  if (git) {
    const gitState = git.clean
      ? "working tree clean"
      : `${git.modifiedFiles.length} uncommitted file(s)`;
    parts.push(`Git: branch "${git.branch}" (${gitState})`);
  }
  if (rules) {
    parts.push(`Standing Rules: loaded from ${rules.source}`);
  }

  return {
    projectRoot,
    projectName,
    git,
    ecosystem,
    projectRules: rules ? { source: rules.source, content: rules.content } : undefined,
    topLevelEntries,
    summary: parts.join(" | "),
  };
}
