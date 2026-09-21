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
  provider: string,
  guardian?: boolean
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
    // Unset means the run predates the 26.3 flag (or used the default) —
    // rendered as ON, since ON is the product default.
    guardian: guardian ?? true,
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

/**
 * Guardian delta (26.3): same model/provider pair with the guardian ON vs OFF.
 * A missing half renders as unavailable — a half-matrix is not a delta.
 */
export function formatGuardianDelta(on: EvalReport | undefined, off: EvalReport | undefined): string {
  const lines: string[] = [];
  lines.push("===============================================================================");
  lines.push(" GUARDIAN DELTA — same tasks, same model, only the interceptor toggled");
  lines.push("-------------------------------------------------------------------------------");
  if (!on || !off) {
    lines.push(" Delta unavailable: need one guardian=on run and one guardian=off run");
    lines.push(`   on:  ${on ? `${on.provider}/${on.model} ${(on.passRate * 100).toFixed(1)}%` : "(missing)"}`);
    lines.push(`   off: ${off ? `${off.provider}/${off.model} ${(off.passRate * 100).toFixed(1)}%` : "(missing)"}`);
    lines.push("===============================================================================");
    return lines.join("\n");
  }
  const taskIds = Array.from(new Set([...on.results, ...off.results].map((r) => r.taskId))).sort();
  lines.push(` ON:  ${on.provider}/${on.model} — ${(on.passRate * 100).toFixed(1)}% (${on.passedCount}/${on.totalTasks})`);
  lines.push(` OFF: ${off.provider}/${off.model} — ${(off.passRate * 100).toFixed(1)}% (${off.passedCount}/${off.totalTasks})`);
  const delta = on.passRate - off.passRate;
  const arrow = delta > 0 ? "guardian helps" : delta < 0 ? "guardian hurts" : "no delta";
  lines.push(` DELTA: ${(delta * 100).toFixed(1)} pts — ${arrow}`);
  lines.push("-------------------------------------------------------------------------------");
  lines.push("| Task ID                        | ON         | OFF        | D          |");
  lines.push("-------------------------------------------------------------------------------");
  for (const id of taskIds) {
    const rOn = on.results.find((r) => r.taskId === id);
    const rOff = off.results.find((r) => r.taskId === id);
    const mark = (r?: EvalResult) => (r ? (r.passed ? "PASS" : "fail") : "-");
    const cell = (s: string) => s.padEnd(10);
    lines.push(`| ${id.padEnd(30)} | ${cell(mark(rOn))} | ${cell(mark(rOff))} | ${cell(
      rOn && rOff ? (rOn.passed === rOff.passed ? "=" : rOn.passed ? "+on" : "+off") : "n/a"
    )} |`);
  }
  lines.push("===============================================================================");
  lines.push("");
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
