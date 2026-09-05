import fs from "node:fs";
import path from "node:path";
import { anvilHome } from "@anvil/core";
import { REQUIRED_COLOR_KEYS, type Theme } from "./themes.js";

// ---------------------------------------------------------------------------
// custom user themes (~/.anvil/themes.json, ANVIL_HOME-honoring).
// { "<name>": { "colors": {<every REQUIRED_COLOR_KEYS entry>}, "spacing"? } }
// ---------------------------------------------------------------------------

export const CUSTOM_THEME_NAME_RE = /^[a-z0-9-_]{1,24}$/;
const BUILTINS = new Set(["dark", "light", "highContrast"]);

export interface CustomThemeProblem {
  name: string;
  error: string;
}

export function customThemesPath(): string {
  return path.join(anvilHome(), "themes.json");
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Load + validate custom themes. Missing file → empty, never throws.
 * Invalid entries are reported (never half-loaded): colors must carry every
 * required key as a non-empty string (any chalk/ink color: named or hex);
 * spacing entries must be non-negative integers, defaulting to {1, 0}.
 */
export function loadCustomThemes(): { themes: Record<string, Theme>; problems: CustomThemeProblem[] } {
  let text: string;
  try {
    text = fs.readFileSync(customThemesPath(), "utf-8");
  } catch {
    return { themes: {}, problems: [] }; // no file yet — normal, silent
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { themes: {}, problems: [{ name: "(file)", error: "themes.json is not valid JSON" }] };
  }
  if (!isRecord(raw)) {
    return { themes: {}, problems: [{ name: "(file)", error: "themes.json must be an object map" }] };
  }
  const themes: Record<string, Theme> = {};
  const problems: CustomThemeProblem[] = [];
  for (const [name, entry] of Object.entries(raw)) {
    const problem = (error: string) => problems.push({ name, error });
    if (!CUSTOM_THEME_NAME_RE.test(name)) {
      problem(`invalid theme name (want [a-z0-9-_]{1,24})`);
      continue;
    }
    if (BUILTINS.has(name)) {
      problem(`shadows built-in theme "${name}" — pick another name`);
      continue;
    }
    if (!isRecord(entry) || !isRecord(entry.colors)) {
      problem("theme entry must be an object with a \"colors\" object");
      continue;
    }
    const missing = REQUIRED_COLOR_KEYS.filter(
      (k) => typeof (entry.colors as Record<string, unknown>)[k] !== "string" ||
        ((entry.colors as Record<string, unknown>)[k] as string).length === 0
    );
    if (missing.length > 0) {
      problem(`missing or empty colors: ${missing.join(", ")}`);
      continue;
    }
    const spacing = isRecord(entry.spacing) ? entry.spacing : {};
    const panelPaddingX = spacing.panelPaddingX ?? 1;
    const panelPaddingY = spacing.panelPaddingY ?? 0;
    if (
      typeof panelPaddingX !== "number" || !Number.isInteger(panelPaddingX) || panelPaddingX < 0 ||
      typeof panelPaddingY !== "number" || !Number.isInteger(panelPaddingY) || panelPaddingY < 0
    ) {
      problem("spacing values must be non-negative integers");
      continue;
    }
    const colors = {} as Theme["colors"];
    for (const k of REQUIRED_COLOR_KEYS) colors[k] = (entry.colors as Record<string, string>)[k];
    themes[name] = { colors, spacing: { panelPaddingX, panelPaddingY } };
  }
  return { themes, problems };
}
