import { afterEach, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createProviders, getModelsForProvider, saveCustomProvider } from "@anvil/core";
import { handleSyncFreeModels } from "../handlers/sync.js";

vi.mock("@anvil/core", async importOriginal => ({
  ...await importOriginal<typeof import("@anvil/core")>(),
  syncFreeModels: vi.fn(async () => ({ refreshedAt: "fixture", results: [], errors: [] })),
}));
let root: string | undefined;
afterEach(() => {
  createProviders({}, []); vi.restoreAllMocks(); vi.unstubAllEnvs();
  if (root) fs.rmSync(root, { recursive: true, force: true });
});
it("/sync refreshes dynamic custom catalogs, reports failures, and retains last good rows", async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "anvil-custom-sync-"));
  vi.stubEnv("ANVIL_HOME", root);
  saveCustomProvider({ id: "custom:sync", name: "Sync", baseUrl: "https://fixture.invalid/v1", auth: "none", models: [] });
  const fetcher = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response('{"data":[{"id":"first"}]}'));
  const print = vi.fn();
  await handleSyncFreeModels(print);
  expect(getModelsForProvider("custom:sync").map(model => model.id)).toEqual(["first"]);
  expect(print).toHaveBeenLastCalledWith(expect.stringContaining("custom:sync: 1 models refreshed"));
  fetcher.mockResolvedValue(new Response('{"data":[{"id":"second"}]}'));
  await handleSyncFreeModels(print);
  expect(getModelsForProvider("custom:sync").map(model => model.id)).toEqual(["second"]);
  fetcher.mockResolvedValue(new Response("down", { status: 503 }));
  await handleSyncFreeModels(print);
  expect(print).toHaveBeenLastCalledWith(expect.stringContaining("HTTP 503"));
  expect(getModelsForProvider("custom:sync").map(model => model.id)).toEqual(["second"]);
});
