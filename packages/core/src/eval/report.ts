import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { EvalReport, EvalResult } from "./types.js";
import { atomicWriteText } from "../atomicWrite.js";

export function resolveEvalsDir(override?: string): string {
  if (override) return override;
  const anvilHome = process.env.ANVIL_HOME || path.join(os.homedir(), ".anvil");
  return path.join(anvilHome, "evals");
}

export function createEvalReport(
  results: EvalResult[],
  model: string,
  provider: string
): EvalReport {
  const passedCount = results.filter((r) => r.passed).length;
  const totalTasks = results.length;
  const passRate = totalTasks > 0 ? passedCount / totalTasks : 0;
  const totalWallClockMs = results.reduce((sum, r) => sum + r.wallClockMs, 0);
  const totalTokens = results.reduce(
    (acc, r) => ({
      input: acc.input + r.tokensUsed.input,
      output: acc.output + r.tokensUsed.output,
    }),
    { input: 0, output: 0 }
  );

  return {
    date: new Date().toISOString(),
    timestamp: Date.now(),
    model,
    provider,
    results,
    passRate,
    passedCount,
    totalTasks,
    totalWallClockMs,
    totalTokens,
  };
}

export async function saveEvalReport(
  report: EvalReport,
  customOutputDir?: string
): Promise<string> {
  const baseDir = resolveEvalsDir(customOutputDir);
  const dateDirName = report.date.replace(/[:.]/g, "-");
  const targetDir = path.join(baseDir, dateDirName);
  fs.mkdirSync(targetDir, { recursive: true });

  const reportPath = path.join(targetDir, "report.json");
  await atomicWriteText(reportPath, JSON.stringify(report, null, 2), { mode: 0o600 });
  return reportPath;
}

export function loadRecentReports(evalsDir?: string, limit = 5): EvalReport[] {
  const baseDir = resolveEvalsDir(evalsDir);
  if (!fs.existsSync(baseDir)) return [];

  const entries = fs.readdirSync(baseDir, { withFileTypes: true });
  const reportDirs = entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort()
    .reverse();

  const reports: EvalReport[] = [];
  for (const dir of reportDirs) {
    if (reports.length >= limit) break;
    const repPath = path.join(baseDir, dir, "report.json");
    if (fs.existsSync(repPath)) {
      try {
        const data = JSON.parse(fs.readFileSync(repPath, "utf8"));
        if (data && typeof data.passRate === "number") {
          reports.push(data);
        }
      } catch {
        // ignore corrupted report
      }
    }
  }
  return reports;
}

export function formatEvalReport(report: EvalReport): string {
  const lines: string[] = [];
  lines.push("===============================================================================");
  lines.push(` ANVIL EVALUATION REPORT — ${report.provider} / ${report.model}`);
  lines.push(` Date: ${report.date} | Pass Rate: ${(report.passRate * 100).toFixed(1)}% (${report.passedCount}/${report.totalTasks})`);
  lines.push(` Total Time: ${(report.totalWallClockMs / 1000).toFixed(1)}s | Total Tokens: in ${report.totalTokens.input.toLocaleString()} · out ${report.totalTokens.output.toLocaleString()}`);
  lines.push("-------------------------------------------------------------------------------");
  lines.push("| Task ID                        | Category   | Status | Time    | Tools | Tokens  |");
  lines.push("-------------------------------------------------------------------------------");

  for (const res of report.results) {
    const id = res.taskId.padEnd(30);
    const cat = res.category.padEnd(10);
    const status = res.passed ? "PASS ✓" : "FAIL ✗";
    const time = `${(res.wallClockMs / 1000).toFixed(1)}s`.padStart(7);
    const tools = String(res.toolCalls).padStart(5);
    const tokens = `${res.tokensUsed.input + res.tokensUsed.output}`.padStart(7);
    lines.push(`| ${id} | ${cat} | ${status.padEnd(6)} | ${time} | ${tools} | ${tokens} |`);
    if (res.error && !res.passed) {
      lines.push(`|   ↳ Error: ${res.error.slice(0, 68).padEnd(68)} |`);
    }
  }

  lines.push("===============================================================================");
  return lines.join("\n");
}

export function formatTrendComparison(reports: EvalReport[]): string {
  if (reports.length === 0) return "No historical evaluation reports found.";
  const lines: string[] = [];
  lines.push("===============================================================================");
  lines.push(" ANVIL EVALUATION TREND COMPARISON");
  lines.push("-------------------------------------------------------------------------------");
  lines.push("| Date                 | Model                | Pass Rate | Passed | Duration |");
  lines.push("-------------------------------------------------------------------------------");

  for (const rep of reports) {
    const dateStr = rep.date.slice(0, 19).replace("T", " ").padEnd(20);
    const modelStr = `${rep.provider}/${rep.model}`.slice(0, 20).padEnd(20);
    const rate = `${(rep.passRate * 100).toFixed(1)}%`.padStart(9);
    const count = `${rep.passedCount}/${rep.totalTasks}`.padStart(6);
    const dur = `${(rep.totalWallClockMs / 1000).toFixed(1)}s`.padStart(8);
    lines.push(`| ${dateStr} | ${modelStr} | ${rate} | ${count} | ${dur} |`);
  }

  lines.push("===============================================================================");
  return lines.join("\n");
}
