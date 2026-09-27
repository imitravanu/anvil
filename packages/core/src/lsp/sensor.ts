import { serverForPath } from "./detector.js";
import { getLspClient } from "./client.js";
import type { LspDiagnostic } from "./types.js";

/**
 * Phase 30.4 — Continuous Post-Mutation LSP Diagnostic Sensor.
 * Fast check (<500ms bounded) immediately after a file mutation.
 * Syncs the mutated text to the active LSP server and checks for new compiler diagnostics.
 */
export async function checkPostMutationDiagnostics(
  projectRoot: string,
  absPath: string,
  content: string,
  timeoutMs: number = 400
): Promise<LspDiagnostic[]> {
  try {
    const server = serverForPath(absPath);
    if (!server) return [];

    const client = await getLspClient(server, projectRoot);
    if (!client || client.isDead()) return [];

    const mutationTime = Date.now();
    client.ensureOpen(absPath, server.language, content);

    if (typeof client.diagnosticsForPath === "function") {
      const diags = await client.diagnosticsForPath(absPath, mutationTime, timeoutMs);
      return diags.slice(0, 10);
    }

    const all = await client.waitForDiagnostics(Math.min(timeoutMs, 400));
    return all
      .filter((d) => d.path === absPath || d.path.endsWith(absPath) || absPath.endsWith(d.path))
      .slice(0, 10);
  } catch {
    return [];
  }
}
