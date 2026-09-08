#!/usr/bin/env node
/**
 * Visual regression diff engine (Phase 0 spec: docs/PHASE-0-VISUAL-REGRESSION-SPEC.md)
 * Compares current captures against committed baselines using pixelmatch (threshold 0.1%).
 * Emits diff PNGs and JSON report; exits 0 on pass, non-zero on regression.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_TUI = path.resolve(__dirname, "..");
const CURRENT_DIR = path.join(ROOT_TUI, "__visual-current__");
const BASELINE_DIR = path.join(ROOT_TUI, "__visual-baselines__");
const DIFF_DIR = path.join(ROOT_TUI, "__visual-diffs__");

// Max allowed diff percentage (0.1% per spec VR2)
const DIFF_THRESHOLD_PERCENT = 0.1;
const PIXELMATCH_THRESHOLD = 0.1;

async function main() {
  if (!fs.existsSync(BASELINE_DIR)) {
    console.error(`[visual:diff] Baseline directory missing: ${BASELINE_DIR}`);
    process.exit(1);
  }

  // If current frames don't exist yet, run capture automatically
  if (!fs.existsSync(CURRENT_DIR) || fs.readdirSync(CURRENT_DIR).length === 0) {
    console.log("[visual:diff] No current frames found. Running visual:capture first...");
    execFileSync("node", [path.join(__dirname, "visual-capture.mjs")], { stdio: "inherit" });
  }

  fs.rmSync(DIFF_DIR, { recursive: true, force: true });
  fs.mkdirSync(DIFF_DIR, { recursive: true });

  const baselineDirs = fs
    .readdirSync(BASELINE_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();

  const results = [];
  let failures = 0;

  console.log(`[visual:diff] Comparing current captures against baselines...`);
  console.log(`[visual:diff] Configured threshold: <= ${DIFF_THRESHOLD_PERCENT}% pixel difference`);
  console.log("-------------------------------------------------------------------------------");
  console.log(`| Configuration       | Scenario                | Diff Pixels | Diff %  | Status |`);
  console.log("-------------------------------------------------------------------------------");

  for (const dir of baselineDirs) {
    const baselineSub = path.join(BASELINE_DIR, dir);
    const currentSub = path.join(CURRENT_DIR, dir);

    if (!fs.existsSync(currentSub)) {
      console.warn(`[visual:diff] Missing current directory for ${dir}`);
      failures++;
      continue;
    }

    const files = fs.readdirSync(baselineSub).filter((f) => f.endsWith(".png")).sort();

    for (const file of files) {
      const scenario = path.basename(file, ".png");
      const baselinePath = path.join(baselineSub, file);
      const currentPath = path.join(currentSub, file);

      if (!fs.existsSync(currentPath)) {
        console.log(`| ${dir.padEnd(19)} | ${scenario.padEnd(23)} | MISSING     | -       | FAIL   |`);
        results.push({ config: dir, scenario, status: "missing_current", diffPercent: 100 });
        failures++;
        continue;
      }

      const baselineImg = PNG.sync.read(fs.readFileSync(baselinePath));
      const currentImg = PNG.sync.read(fs.readFileSync(currentPath));

      if (baselineImg.width !== currentImg.width || baselineImg.height !== currentImg.height) {
        console.log(`| ${dir.padEnd(19)} | ${scenario.padEnd(23)} | SIZE MISMATCH | -     | FAIL   |`);
        results.push({ config: dir, scenario, status: "dimension_mismatch", diffPercent: 100 });
        failures++;
        continue;
      }

      const { width, height } = baselineImg;
      const totalPixels = width * height;
      const diffPng = new PNG({ width, height });

      const diffPixels = pixelmatch(
        baselineImg.data,
        currentImg.data,
        diffPng.data,
        width,
        height,
        { threshold: PIXELMATCH_THRESHOLD }
      );

      const diffPercent = Number(((diffPixels / totalPixels) * 100).toFixed(4));
      const passed = diffPercent <= DIFF_THRESHOLD_PERCENT;

      if (!passed) {
        failures++;
        const targetDiffSub = path.join(DIFF_DIR, dir);
        fs.mkdirSync(targetDiffSub, { recursive: true });
        fs.writeFileSync(path.join(targetDiffSub, `${scenario}-diff.png`), PNG.sync.write(diffPng));
      }

      const statusStr = passed ? "\x1b[32mPASS\x1b[0m" : "\x1b[31mFAIL\x1b[0m";
      console.log(
        `| ${dir.padEnd(19)} | ${scenario.padEnd(23)} | ${String(diffPixels).padStart(11)} | ${(diffPercent + "%").padStart(7)} | ${statusStr.padEnd(6)} |`
      );

      results.push({
        config: dir,
        scenario,
        diffPixels,
        totalPixels,
        diffPercent,
        passed,
      });
    }
  }

  console.log("-------------------------------------------------------------------------------");

  const report = {
    timestamp: new Date().toISOString(),
    total: results.length,
    passed: results.filter((r) => r.passed).length,
    failed: failures,
    thresholdPercent: DIFF_THRESHOLD_PERCENT,
    results,
  };

  fs.writeFileSync(path.join(DIFF_DIR, "report.json"), JSON.stringify(report, null, 2), "utf-8");

  if (failures > 0) {
    console.error(`\x1b[31m[visual:diff] FAILED: ${failures} of ${results.length} scenarios exceeded threshold.\x1b[0m`);
    console.error(`[visual:diff] Diff images and report saved in: ${DIFF_DIR}`);
    process.exit(1);
  } else {
    console.log(`\x1b[32m[visual:diff] SUCCESS: All ${results.length} visual scenarios match within ${DIFF_THRESHOLD_PERCENT}%.\x1b[0m`);
    process.exit(0);
  }
}

main().catch((err) => {
  console.error("[visual:diff] Fatal error:", err);
  process.exit(1);
});
