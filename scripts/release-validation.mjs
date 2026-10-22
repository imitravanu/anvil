import fs from "node:fs";
import path from "node:path";

/** Validate before packing or publishing anything; tag input never reaches a shell. */
export function validateRelease(root, workspaces, tag) {
  const packages = workspaces.map(ws => JSON.parse(fs.readFileSync(path.join(root, ws, "package.json"), "utf8")));
  const version = packages[0].version;
  if (packages.some(pkg => pkg.version !== version)) throw new Error("Workspace package versions differ.");
  const lock = JSON.parse(fs.readFileSync(path.join(root, "package-lock.json"), "utf8"));
  if (workspaces.some(ws => lock.packages?.[ws]?.version !== version)) throw new Error("Lockfile workspace versions differ from package versions.");
  const source = fs.readFileSync(path.join(root, "packages/core/src/version.ts"), "utf8");
  const coreVersion = source.match(/export const CORE_VERSION\s*=\s*["']([^"']+)["']/)?.[1];
  if (coreVersion !== version) throw new Error("CORE_VERSION differs from package versions.");
  if (tag !== undefined && (!/^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(tag) || tag !== `v${version}`)) {
    throw new Error(`Release tag must match package version v${version}.`);
  }
  return version;
}
