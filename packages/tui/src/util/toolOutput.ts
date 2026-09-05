import { capLines } from "./displayLimits.js";
/** expandable tool output: render a retained tool result as capped lines. */
export { EXPANDED_MAX_LINES as MAX_OUTPUT_LINES } from "./displayLimits.js";

/** Format a retained tool-call output for expanded display. Pure. */
export function formatToolOutput(output: unknown): string[] {
  if (output === undefined || output === null) return ["(no output)"];
  if (typeof output === "object") {
    const o = output as Record<string, unknown>;
    // run_command shape: lead with the streams, not the envelope.
    if (typeof o.stdout === "string" || typeof o.stderr === "string") {
      const lines: string[] = [];
      const stdout = typeof o.stdout === "string" ? o.stdout : "";
      const stderr = typeof o.stderr === "string" ? o.stderr : "";
      if (stdout) lines.push(...stdout.split("\n"));
      if (stderr) lines.push(...stderr.split("\n").map((l) => `stderr: ${l}`));
      const meta: string[] = [];
      if (typeof o.exitCode === "number") meta.push(`exit ${o.exitCode}`);
      if (o.stdoutTruncated || o.stderrTruncated) meta.push("stream capped at ~20KB");
      if (o.timedOut) meta.push("timed out");
      if (meta.length > 0) lines.push(`(${meta.join(", ")})`);
      if (lines.length === 0) return ["(empty output)"];
      return capLines(lines);
    }
    try {
      return capLines(JSON.stringify(output, null, 2).split("\n"));
    } catch {
      return ["(output not serializable)"];
    }
  }
  return capLines(String(output).split("\n"));
}
