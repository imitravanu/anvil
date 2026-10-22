import { describe, it, expect, vi, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { runNativeGate, scanWorkingTree } from "../gate.js";
import { GATE_DIFF_MAX_BUFFER_BYTES } from "@imitravanu/anvil-core";

function git(cwd: string, ...args: string[]): void {
  execFileSync("git", ["-c", "user.email=t@t.t", "-c", "user.name=t", ...args], {
    cwd,
    stdio: "pipe",
  });
}

const dirs: string[] = [];
function tmp(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "anvil-native-gate-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function capture(): { stdout: () => string; stderr: () => string } {
  const out: string[] = [];
  const err: string[] = [];
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    out.push(String(chunk));
    return true;
  });
  vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    err.push(String(chunk));
    return true;
  });
  return { stdout: () => out.join(""), stderr: () => err.join("") };
}

describe("runNativeGate (in-process scan)", () => {
  it("reports an error and exits 1 outside a git repository", () => {
    const dir = tmp();
    const io = capture();
    expect(runNativeGate({ cwd: dir })).toBe(1);
    expect(io.stderr()).toContain("anvil gate:");
  });

  it("exits 0 on a clean working tree", () => {
    const dir = tmp();
    git(dir, "init", "-q");
    fs.writeFileSync(path.join(dir, "a.ts"), "export const x = 1;\n");
    git(dir, "add", "-A");
    git(dir, "commit", "-qm", "init");

    const io = capture();
    expect(runNativeGate({ cwd: dir })).toBe(0);
    expect(io.stdout()).toContain("clean tree");
  });

  it("exits 1 and lists the violation when the diff carries slop", () => {
    const dir = tmp();
    git(dir, "init", "-q");
    const file = path.join(dir, "a.ts");
    fs.writeFileSync(file, "export const x = 1;\n");
    git(dir, "add", "-A");
    git(dir, "commit", "-qm", "init");
    // Split so this test source never carries the literal pattern it plants;
    // the temp repo is foreign scope, where the universal rules still apply.
    fs.writeFileSync(file, "export const x = 1;\nconst y = z as " + "any;\n");

    const io = capture();
    expect(runNativeGate({ cwd: dir })).toBe(1);
    expect(io.stdout()).toContain("violation");
    expect(io.stdout()).toContain("npm run gate");
  });

  // Batch O: the diff is resolved per file BEFORE judging, so a violation names
  // the file that holds it and the line it will occupy — and the path-aware
  // policy (test-file exemption, non-code paths) is the authority's, not one
  // synthetic label's.
  it("names the real file and line, per file, across a multi-file diff", () => {
    const dir = tmp();
    git(dir, "init", "-q");
    fs.mkdirSync(path.join(dir, "src"), { recursive: true });
    fs.writeFileSync(path.join(dir, "src", "a.ts"), "export const a = 1;\n");
    git(dir, "add", "-A");
    git(dir, "commit", "-qm", "init");

    fs.writeFileSync(
      path.join(dir, "src", "a.ts"),
      "export const a = 1;\nexport const b = data as " + "any;\n"
    );
    // A test path is judged by the skipped-test rule alone: the fixture cast on
    // line 1 is exempt, the skip on line 2 is caught at its own line.
    fs.mkdirSync(path.join(dir, "src", "__tests__"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, "src", "__tests__", "b.test.ts"),
      "const fixture = data as " + "any;\n" + "it." + 'skip("later", () => {});\n'
    );
    git(dir, "add", "-A");

    const io = capture();
    expect(runNativeGate({ cwd: dir })).toBe(1);
    const out = io.stdout();
    expect(out).toContain("src/a.ts:2");
    expect(out).toContain("src/__tests__/b.test.ts:2");
    // The fixture cast on the test file's line 1 must NOT be reported.
    expect(out).not.toContain("src/__tests__/b.test.ts:1");
    // Neither a synthetic whole-diff label nor an index into the added text.
    expect(out).not.toContain("(working tree)");
  });

  it("does not judge a non-code path with the built-in rules", () => {
    const dir = tmp();
    git(dir, "init", "-q");
    fs.writeFileSync(path.join(dir, "README.md"), "# Notes\n");
    git(dir, "add", "-A");
    git(dir, "commit", "-qm", "init");
    // A doc line that would be a placeholder violation if the file were read as
    // code; it used to be judged under the synthetic label.
    fs.writeFileSync(path.join(dir, "README.md"), "# Notes\nnever leave a " + "TO" + "DO in code\n");

    const io = capture();
    expect(runNativeGate({ cwd: dir })).toBe(0);
    expect(io.stdout()).toContain("clean tree");
  });

  // Batch P (F3, takeover 2026-10-10): `git diff HEAD` cannot see a brand-new
  // untracked file, so the most common first act of slop — a new file — was the
  // one thing the product gate never reported. RED first: this repo exited 0
  // ("clean tree") before the untracked pass.
  it("reports violations in UNTRACKED files at their real file and line", () => {
    const dir = tmp();
    git(dir, "init", "-q");
    fs.writeFileSync(path.join(dir, "base.ts"), "export const base = 1;\n");
    git(dir, "add", "-A");
    git(dir, "commit", "-qm", "init");

    // A slop-carrying untracked source file, judged at its own path and line.
    fs.writeFileSync(path.join(dir, "fresh.ts"), "export const y = data as " + "any;\n");
    // An untracked TEST path is judged by the skipped-test rule alone: the
    // fixture cast inside it must be exempt, exactly as for tracked files.
    fs.mkdirSync(path.join(dir, "__tests__"), { recursive: true });
    fs.writeFileSync(path.join(dir, "__tests__", "fresh.test.ts"), "const fixture = data as " + "any;\n");

    const io = capture();
    expect(runNativeGate({ cwd: dir })).toBe(1);
    const out = io.stdout();
    expect(out).toContain("fresh.ts:1");
    expect(out).not.toContain("__tests__/fresh.test.ts:1");
  });

  it("fails closed when an untracked file is too large to scan", () => {
    const dir = tmp();
    git(dir, "init", "-q");
    fs.writeFileSync(path.join(dir, "base.ts"), "export const base = 1;\n");
    git(dir, "add", "base.ts");
    git(dir, "commit", "-qm", "init");
    fs.writeFileSync(path.join(dir, "large.ts"), "");
    fs.truncateSync(path.join(dir, "large.ts"), GATE_DIFF_MAX_BUFFER_BYTES + 1);
    const scan = scanWorkingTree(dir);
    expect(scan.error).toContain("diff size limit");
  });

  it("fails closed on an untracked symlink instead of following it", () => {
    const dir = tmp();
    git(dir, "init", "-q");
    fs.writeFileSync(path.join(dir, "base.ts"), "export const base = 1;\n");
    git(dir, "add", "base.ts");
    git(dir, "commit", "-qm", "init");
    fs.symlinkSync(path.join(dir, "base.ts"), path.join(dir, "link.ts"));
    const scan = scanWorkingTree(dir);
    expect(scan.error).toContain("non-regular untracked file");
  });
});
