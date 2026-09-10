import { execFile } from "node:child_process";
import { promisify } from "node:util";

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
 * Stages all changes and creates an automated milestone commit.
 * Format: "anvil(goal): milestone <id> — <title>"
 * Never throws — returns failure details if git is uninitialized or working tree is clean.
 */
export async function autoCommitMilestone(
  projectRoot: string,
  milestoneId: string | number,
  title: string
): Promise<GitCommitResult> {
  const commitMsg = `anvil(goal): milestone ${milestoneId} — ${title}`;

  try {
    // 1. Stage all changes
    await execFileAsync("git", ["add", "-A"], { cwd: projectRoot });

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
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Generates unified git diff comparing projectRoot HEAD against a base branch.
 */
export async function getBranchDiff(projectRoot: string, branch: string): Promise<string> {
  try {
    // Try triple-dot diff first (branch...HEAD), fallback to branch HEAD
    const { stdout } = await execFileAsync("git", ["diff", `${branch}...HEAD`], {
      cwd: projectRoot,
      maxBuffer: 2 * 1024 * 1024,
    });
    return stdout;
  } catch (err: any) {
    // Try two-dot diff or direct branch diff if triple-dot fails
    try {
      const { stdout } = await execFileAsync("git", ["diff", branch], {
        cwd: projectRoot,
        maxBuffer: 2 * 1024 * 1024,
      });
      return stdout;
    } catch {
      throw new Error(`Failed to diff against branch "${branch}": ${err?.message ?? String(err)}`);
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
    const msg = err?.message ?? String(err);
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
