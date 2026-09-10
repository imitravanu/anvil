#!/usr/bin/env node
/**
 * Visual regression approval script (Phase 0 spec: docs/PHASE-0-VISUAL-REGRESSION-SPEC.md VR4)
 * Promotes current captures (__visual-current__/) to committed baselines (__visual-baselines__/).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_TUI = path.resolve(__dirname, "..");
const CURRENT_DIR = path.join(ROOT_TUI, "__visual-current__");
const BASELINE_DIR = path.join(ROOT_TUI, "__visual-baselines__");

import { execFileSync } from "node:child_process";

function copyDir(src, dest) {
  if (!fs.existsSync(src)) {
    throw new Error(`Source directory does not exist: ${src}`);
  }
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });

  let count = 0;
  const scenarios = new Set();
  const configs = new Set();

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      configs.add(entry.name);
      fs.mkdirSync(destPath, { recursive: true });
      const subEntries = fs.readdirSync(srcPath, { withFileTypes: true });
      for (const sub of subEntries) {
        if (sub.isFile() && sub.name.endsWith(".png")) {
          fs.copyFileSync(path.join(srcPath, sub.name), path.join(destPath, sub.name));
          scenarios.add(path.basename(sub.name, ".png"));
          count++;
        }
      }
    } else if (entry.isFile() && entry.name.endsWith(".png")) {
      fs.copyFileSync(srcPath, destPath);
      scenarios.add(path.basename(entry.name, ".png"));
      count++;
    }
  }
  return { count, configs: Array.from(configs).sort(), scenarios: Array.from(scenarios).sort() };
}

try {
  console.log(`[visual:approve] Promoting current captures to baselines...`);
  const { count, configs, scenarios } = copyDir(CURRENT_DIR, BASELINE_DIR);
  console.log(`[visual:approve] Successfully updated ${count} baseline PNG frames across ${configs.length} configurations:`);
  for (const cfg of configs) {
    console.log(`  - ${cfg}`);
  }
  console.log(`[visual:approve] Scenarios covered (${scenarios.length}): ${scenarios.join(", ")}`);

  // Stage changes via git if inside git work tree
  try {
    execFileSync("git", ["add", BASELINE_DIR], { stdio: "pipe" });
    console.log(`[visual:approve] Staged baseline updates in git: ${BASELINE_DIR}`);
  } catch (gitErr) {
    console.log(`[visual:approve] Note: git add skipped (${gitErr.message})`);
  }

  console.log(`[visual:approve] Ready to commit approved visual baselines.`);
} catch (err) {
  console.error(`[visual:approve] Error:`, err.message);
  process.exit(1);
}
