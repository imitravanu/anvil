import { serverForPath } from "./detector.js";
import { getLspClient } from "./client.js";
import type { LspDiagnostic } from "./types.js";
import { LSP_POST_MUTATION_DIAGNOSTICS_MS, LSP_SENSOR_DIAGNOSTICS_MAX } from "../config/constants.js";

/**
 * Phase 30.4 — Continuous Post-Mutation LSP Diagnostic Sensor.
 * Fast check (<500ms bounded) immediately after a file mutation.
 * Syncs the mutated text to the active LSP server and checks for new compiler diagnostics.
 */
export async function checkPostMutationDiagnostics(
  projectRoot: string,
  absPath: string,
  content: string,
  timeoutMs: number = LSP_POST_MUTATION_DIAGNOSTICS_MS
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
      return diags.slice(0, LSP_SENSOR_DIAGNOSTICS_MAX);
    }

    const all = await client.waitForDiagnostics(Math.min(timeoutMs, LSP_POST_MUTATION_DIAGNOSTICS_MS));
    return all
      .filter((d) => d.path === absPath)
      .slice(0, LSP_SENSOR_DIAGNOSTICS_MAX);
  } catch {
    // intentional: a diagnostics fetch is an optional sensor reading — a
    // failure means "no diagnostics", not a failed mutation.
    return [];
  }
}
