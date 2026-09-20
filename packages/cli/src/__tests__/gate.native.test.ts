import { describe, it, expect, vi, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { runNativeGate } from "../gate.js";

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
});
