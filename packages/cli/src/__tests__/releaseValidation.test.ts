import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const repo = path.resolve(import.meta.dirname, "../../../..");
const validation = pathToFileURL(path.join(repo, "scripts/release-validation.mjs")).href;
const workspaces = ["packages/core", "packages/tui", "packages/cli"];
let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "anvil-release-validation-"));
  for (const ws of workspaces) {
    fs.mkdirSync(path.join(root, ws), { recursive: true });
    fs.writeFileSync(path.join(root, ws, "package.json"), JSON.stringify({ version: "1.2.3" }));
  }
  fs.mkdirSync(path.join(root, "packages/core/src"));
  fs.writeFileSync(path.join(root, "packages/core/src/version.ts"), 'export const CORE_VERSION = "1.2.3";');
  fs.writeFileSync(path.join(root, "package-lock.json"), JSON.stringify({ packages: Object.fromEntries(workspaces.map(ws => [ws, { version: "1.2.3" }])) }));
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));
function validate(tag = "v1.2.3") {
  return execFileSync(process.execPath, ["--input-type=module", "-e", `import {validateRelease} from ${JSON.stringify(validation)}; console.log(validateRelease(process.argv[1], ${JSON.stringify(workspaces)}, process.argv[2]));`, root, tag], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}
describe("release consistency preflight", () => {
  it("accepts aligned package, lockfile, core and tag versions", () => expect(validate().trim()).toBe("1.2.3"));
  it.each(["v1.2.4", "other-tag", "v1.2.3;echo bad"])("refuses tag %s before packing", tag => expect(() => validate(tag)).toThrow());
  it("refuses a workspace version mismatch", () => {
    fs.writeFileSync(path.join(root, "packages/tui/package.json"), '{"version":"9.0.0"}');
    expect(() => validate()).toThrow("Workspace package versions differ");
  });
  it("refuses a core constant mismatch", () => {
    fs.writeFileSync(path.join(root, "packages/core/src/version.ts"), 'export const CORE_VERSION = "9.0.0";');
    expect(() => validate()).toThrow("CORE_VERSION differs");
  });
  it("refuses stale lockfile workspace versions", () => {
    fs.writeFileSync(path.join(root, "package-lock.json"), '{"packages":{}}');
    expect(() => validate()).toThrow("Lockfile workspace versions differ");
  });
});
