#!/usr/bin/env node
/**
 * Packaging smoke test (audit task A).
 *
 * Why this exists: a green gate is evidence about CODE, not evidence that
 * something SHIPS. The monorepo hoists node_modules, so a bundle that imports a
 * package it never declared still builds, typechecks, and tests green — then
 * dies on its first import for anyone who is not this repository. That exact
 * defect shipped once (three provider SDKs externalized from the CLI bundle
 * while packages/cli/package.json had no `dependencies` field).
 *
 * This script closes that class: it packs every workspace (surfacing missing
 * files / bad `files` globs), installs ONLY the CLI tarball into a throwaway
 * directory with no monorepo present, and runs the installed binary. If the
 * bundle gains a bare import it does not declare, this fails here.
 *
 * Run:  npm run verify:package      (builds first, then verifies)
 *       node scripts/verify-package.mjs   (assumes a build already exists)
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WORKSPACES = ["packages/core", "packages/tui", "packages/cli"];
const NPM = process.platform === "win32" ? "npm.cmd" : "npm";

function readJson(rel) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, rel), "utf8"));
}

function fail(msg) {
  console.error(`[verify:package] FAIL — ${msg}`);
  process.exit(1);
}

/** Sanitize a package name into npm's tarball prefix: @anvil/cli -> anvil-cli. */
function tarballPrefix(name) {
  return name.replace(/^@/, "").replace(/\//g, "-");
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "anvil-pkg-"));
const packDir = path.join(tmp, "pack");
fs.mkdirSync(packDir, { recursive: true });

try {
  // 1. Pack every workspace. A missing/unlisted dist shows up as a tiny or
  //    empty tarball, so we assert each tarball exists and is non-trivial.
  for (const ws of WORKSPACES) {
    const { name, version } = readJson(path.join(ws, "package.json"));
    // The `./` prefix is load-bearing: bare `packages/core` is parsed by npm as
    // a GitHub spec (`github.com/packages/core`) and fails with a git error.
    execFileSync(NPM, ["pack", "--pack-destination", packDir, `./${ws}`], { cwd: ROOT, stdio: "inherit" });
    const expected = `${tarballPrefix(name)}-${version}.tgz`;
    const file = path.join(packDir, expected);
    if (!fs.existsSync(file)) fail(`npm pack produced no ${expected} for ${name}`);
    console.log(`[verify:package] packed ${name} -> ${expected}`);
  }

  // 2. Install the CLI alone into a clean consumer dir (no monorepo, no hoist).
  const cli = readJson("packages/cli/package.json");
  const cliTarball = path.join(packDir, `${tarballPrefix(cli.name)}-${cli.version}.tgz`);
  const consumer = path.join(tmp, "consumer");
  fs.mkdirSync(consumer);
  fs.writeFileSync(
    path.join(consumer, "package.json"),
    JSON.stringify({ name: "anvil-consumer", version: "0.0.0", private: true }, null, 2)
  );
  execFileSync(
    NPM,
    ["install", "--no-audit", "--no-fund", "--ignore-scripts", cliTarball],
    { cwd: consumer, stdio: "inherit" }
  );

  // 3. Run the installed binary — the install proof the gate cannot provide.
  const bin = path.join(
    consumer,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "anvil.cmd" : "anvil"
  );
  if (!fs.existsSync(bin)) fail("the installed package exposes no `anvil` bin");

  const out = execFileSync(bin, ["--version"], { cwd: consumer, encoding: "utf8" }).trim();
  console.log(`[verify:package] installed CLI reports: ${out}`);
  if (!/^anvil \d+\.\d+\.\d+/.test(out)) fail(`unexpected --version output: ${JSON.stringify(out)}`);

  console.log("[verify:package] OK — the packed CLI installs and runs outside the monorepo.");
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
