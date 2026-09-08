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

function copyDir(src, dest) {
  if (!fs.existsSync(src)) {
    throw new Error(`Source directory does not exist: ${src}`);
  }
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });

  let count = 0;
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      count += copyDir(srcPath, destPath);
    } else if (entry.isFile() && entry.name.endsWith(".png")) {
      fs.copyFileSync(srcPath, destPath);
      count++;
    }
  }
  return count;
}

try {
  console.log(`[visual:approve] Promoting current captures to baselines...`);
  const count = copyDir(CURRENT_DIR, BASELINE_DIR);
  console.log(`[visual:approve] Successfully updated ${count} baseline PNG frames in: ${BASELINE_DIR}`);
  console.log(`[visual:approve] You can now git commit the updated baselines.`);
} catch (err) {
  console.error(`[visual:approve] Error:`, err.message);
  process.exit(1);
}
