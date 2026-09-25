#!/usr/bin/env node
/**
 * CLI startup + bundle measurement (work plan T8).
 *
 * The CLI bundles to ~6.5 MB, but "is that fine?" was an assumption, not a
 * measurement. This prints the numbers so the assumption can be re-checked after
 * any dependency or bundler change. No dependencies, no config, no side effects
 * beyond spawning the built CLI a few times.
 *
 * Run: `npm run measure:startup` (requires `npm run build` first).
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLI = path.join(ROOT, "packages", "cli", "dist", "index.js");
const RUNS = 10;

if (!existsSync(CLI)) {
  console.error("dist missing — run `npm run build` first.");
  process.exit(1);
}

/**
 * Wall-clock ms for one `--version` run (a fixed, provider-free path).
 * @returns {number}
 */
function runOnce() {
  const started = process.hrtime.bigint();
  execFileSync(process.execPath, [CLI, "--version"], { stdio: "ignore" });
  return Number(process.hrtime.bigint() - started) / 1e6;
}

// One warm-up run so the measurement is not dominated by a cold page cache —
// reported separately rather than quietly folded in.
const warmup = runOnce();
const samples = Array.from({ length: RUNS }, runOnce).sort((a, b) => a - b);
const median = samples[Math.floor(samples.length / 2)];
const p95 = samples[Math.min(samples.length - 1, Math.floor(samples.length * 0.95))];

/**
 * @param {string} dir
 * @returns {number} total bytes
 */
function dirSize(dir) {
  let total = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    total += entry.isDirectory() ? dirSize(full) : statSync(full).size;
  }
  return total;
}

const bundleBytes = statSync(CLI).size;
const coreDist = path.join(ROOT, "packages", "core", "dist");
const tuiDist = path.join(ROOT, "packages", "tui", "dist");
const mb = (bytes) => (bytes / 1024 / 1024).toFixed(2);

console.log("ANVIL CLI STARTUP + BUNDLE");
console.log("================================================================");
console.log(` node --version path: ${samples.length} timed runs of \`anvil --version\``);
console.log(`   warm-up (reported, not counted): ${warmup.toFixed(0)} ms`);
console.log(`   median: ${median.toFixed(0)} ms`);
console.log(`   p95:    ${p95.toFixed(0)} ms`);
console.log(`   fastest / slowest: ${samples[0].toFixed(0)} ms / ${samples[samples.length - 1].toFixed(0)} ms`);
console.log("----------------------------------------------------------------");
console.log(` cli bundle (dist/index.js): ${mb(bundleBytes)} MB`);
if (existsSync(coreDist)) console.log(` core dist total:            ${mb(dirSize(coreDist))} MB`);
if (existsSync(tuiDist)) console.log(` tui dist total:             ${mb(dirSize(tuiDist))} MB`);
console.log("================================================================");
console.log(" If a dependency is added or bundler flags change, re-run and diff these.");
