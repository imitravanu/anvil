/** U6 expandable tool output: render a retained tool result as capped lines. */
export const MAX_OUTPUT_LINES = 30;

function capLines(lines: string[]): string[] {
  if (lines.length <= MAX_OUTPUT_LINES) return lines;
  return [
    ...lines.slice(0, MAX_OUTPUT_LINES),
    `… ${lines.length - MAX_OUTPUT_LINES} more line(s) omitted`,
  ];
}

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
