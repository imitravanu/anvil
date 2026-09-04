import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ModelInfo } from "./types.js";

const MODELS_CACHE_PATH = path.join(os.homedir(), ".anvil", "models-cache.json");

export function loadModelsCache(): ModelInfo[] {
  try {
    const raw = fs.readFileSync(MODELS_CACHE_PATH, "utf-8");
    return JSON.parse(raw) as ModelInfo[];
  } catch {
    return [];
  }
}

export function saveModelsCache(models: ModelInfo[]): void {
  try {
    fs.mkdirSync(path.dirname(MODELS_CACHE_PATH), { recursive: true });
    fs.writeFileSync(MODELS_CACHE_PATH, JSON.stringify(models, null, 2), "utf-8");
  } catch {
    // Non-fatal
  }
}
