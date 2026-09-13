import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getErrorMessage } from "../errors.js";

const execFileAsync = promisify(execFile);

export interface GitCommitResult {
  committed: boolean;
  hash?: string;
  message?: string;
  error?: string;
}

export interface PrResult {
  success: boolean;
  url?: string;
  output?: string;
  error?: string;
}

/**
 * Stages exactly the session-touched paths and creates an automated milestone commit.
 * Format: "anvil(goal): milestone <id> — <title>"
 * Never stages the whole tree: an untracked `.env` or stray key file the mission
 * did not touch must never be swept into history (the old `git add -A` did).
 * With no paths the commit is refused (fail closed) — never throws, returns
 * failure details if git is uninitialized or there is nothing to commit.
 */
export async function autoCommitMilestone(
  projectRoot: string,
  milestoneId: string | number,
  title: string,
  paths?: readonly string[]
): Promise<GitCommitResult> {
  const commitMsg = `anvil(goal): milestone ${milestoneId} — ${title}`;
  const scoped = (paths ?? []).filter((p) => typeof p === "string" && p.length > 0);
  if (scoped.length === 0) {
    return {
      committed: false,
      message: "No session-touched files to commit — refusing to stage the whole tree.",
    };
  }

  try {
    // 1. Stage ONLY the session-touched paths. `--` ends flag parsing so a
    // path beginning with `-` can never be mistaken for a git flag.
    await execFileAsync("git", ["add", "--", ...scoped], { cwd: projectRoot });

    // 2. Commit
    const { stdout } = await execFileAsync("git", ["commit", "-m", commitMsg], {
      cwd: projectRoot,
    });

    // Extract short commit hash if present
    const hashMatch = stdout.match(/\[[^\s]+ ([0-9a-f]{7,40})\]/i);
    const hash = hashMatch ? hashMatch[1] : undefined;

    return {
      committed: true,
      hash,
      message: commitMsg,
    };
  } catch (err: any) {
    const stderr = (err?.stderr || "").toString();
    const stdout = (err?.stdout || "").toString();
    const combined = `${stdout} ${stderr}`.toLowerCase();

    if (combined.includes("nothing to commit") || combined.includes("working tree clean")) {
      return {
        committed: false,
        message: "Working tree clean (no modified files to commit)",
      };
    }

    return {
      committed: false,
      error: getErrorMessage(err),
    };
  }
}

/**
 * Generates unified git diff comparing projectRoot HEAD against a base branch.
 */
export async function getBranchDiff(projectRoot: string, branch: string): Promise<string> {
  try {
    // Try triple-dot diff first (branch...HEAD), fallback to branch HEAD.
    // `--` ends flag parsing so a branch beginning with `-` cannot inject flags.
    const { stdout } = await execFileAsync("git", ["diff", `${branch}...HEAD`, "--"], {
      cwd: projectRoot,
      maxBuffer: 2 * 1024 * 1024,
    });
    return stdout;
  } catch (err: any) {
    // Try two-dot diff or direct branch diff if triple-dot fails
    try {
      const { stdout } = await execFileAsync("git", ["diff", branch, "--"], {
        cwd: projectRoot,
        maxBuffer: 2 * 1024 * 1024,
      });
      return stdout;
    } catch {
      throw new Error(`Failed to diff against branch "${branch}": ${getErrorMessage(err)}`);
    }
  }
}

/**
 * Creates a GitHub Pull Request via gh CLI: "gh pr create --fill".
 */
export async function createPullRequest(projectRoot: string): Promise<PrResult> {
  try {
    const { stdout, stderr } = await execFileAsync("gh", ["pr", "create", "--fill"], {
      cwd: projectRoot,
    });

    const out = `${stdout}\n${stderr}`.trim();
    // Extract GitHub PR url
    const urlMatch = out.match(/https:\/\/github\.com\/[^\s]+\/pull\/\d+/);

    return {
      success: true,
      url: urlMatch ? urlMatch[0] : out,
      output: out,
    };
  } catch (err: any) {
    const msg = getErrorMessage(err);
    if (msg.includes("ENOENT") || msg.includes("not found")) {
      return {
        success: false,
        error: "GitHub CLI (`gh`) is not installed or not found in PATH.",
      };
    }
    return {
      success: false,
      error: `gh pr create failed: ${err?.stderr?.toString() || msg}`,
    };
  }
}
