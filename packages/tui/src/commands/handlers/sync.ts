import {
  createOpenRouterFreeSource,
  createOrcarouterFreeSource,
  syncFreeModels,
} from "@anvil/core";

export async function handleSyncFreeModels(printSystemMessage: (text: string) => void): Promise<void> {
  printSystemMessage("Checking free-model sources for live updates...");
  const report = await syncFreeModels({
    sources: [createOpenRouterFreeSource(), createOrcarouterFreeSource()],
    ttlMs: 0,
  });
  let msg = report.refreshedAt
    ? `✓ Refreshed free-model list (${report.results.reduce((m, r) => m + r.count, 0)} known free models).`
    : "✓ No refresh needed — data is current.";
  for (const r of report.results) {
    if (!r.ok) {
      msg += `\n  ✗ ${r.sourceId}: ${r.error ?? "unknown error"}`;
      continue;
    }
    if (r.newlyFree.length > 0) {
      msg += `\n  + ${r.newlyFree.length} new free: ${r.newlyFree.slice(0, 6).join(", ")}${r.newlyFree.length > 6 ? " …" : ""}`;
    }
    if (r.noLongerFree.length > 0) {
      msg += `\n  - ${r.noLongerFree.length} became paid: ${r.noLongerFree.slice(0, 6).join(", ")}${r.noLongerFree.length > 6 ? " …" : ""}`;
    }
  }
  if (report.errors.length > 0) {
    msg += `\n  ⚠ ${report.errors.length} source(s) failed: ${report.errors.join("; ")}`;
  }
  printSystemMessage(msg);
}
