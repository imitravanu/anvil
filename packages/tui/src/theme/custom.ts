import fs from "node:fs";
import path from "node:path";
import { anvilHome } from "@anvil/core";
import {
  DEFAULT_BORDERS,
  DEFAULT_RESPONSIVE,
  DEFAULT_SPACING,
  DEFAULT_TYPOGRAPHY,
  REQUIRED_COLOR_KEYS,
  SEMANTIC_COLOR_KEYS,
  THEMES,
  resolveThemeColors,
  type CardBorderStyle,
  type LegacyColorKey,
  type ModalBorderStyle,
  type PanelBorderStyle,
  type SemanticColorKey,
  type Theme,
} from "./themes.js";

// ---------------------------------------------------------------------------
// custom user themes (~/.anvil/themes.json, ANVIL_HOME-honoring).
// { "<name>": { "colors": {<every REQUIRED_COLOR_KEYS entry>}, ... } }
// DW-1: old 11-key files keep loading — semantic colors derive from legacy
// keys; typography / spacing / borders / responsive sections are optional
// with defaults. New keys may override any derivation.
// ---------------------------------------------------------------------------

export const CUSTOM_THEME_NAME_RE = /^[a-z0-9-_]{1,24}$/;
// Derived from the theme registry, not a hand-kept list: adding a built-in
// theme used to silently leave this guard behind, letting a custom theme of
// the same name shadow it (and `isThemeName` then call the shadow built-in).
const BUILTINS = new Set(Object.keys(THEMES));

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

const PANEL_BORDERS: readonly string[] = ["round", "single", "double", "bold"];
const CARD_BORDERS: readonly string[] = ["round", "single", "none"];
const MODAL_BORDERS: readonly string[] = ["round", "double"];

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

function isNonNegativeInt(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0;
}

function isPositiveInt(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v > 0;
}

/**
 * Load + validate custom themes. Missing file → empty, never throws.
 * Invalid entries are reported (never half-loaded): colors must carry every
 * required legacy key as a non-empty string (any chalk/ink color: named or
 * hex); semantic colors, typography, spacing, borders, and responsive
 * sections are optional and defaulted (old files auto-migrate).
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
    const colorsRaw = entry.colors as Record<string, unknown>;
    const legacy = {} as Record<LegacyColorKey, string>;
    for (const k of REQUIRED_COLOR_KEYS) legacy[k] = colorsRaw[k] as string;
    // Optional semantic overrides (validated, else derivation wins).
    const overrides: Partial<Record<SemanticColorKey, string>> = {};
    for (const k of SEMANTIC_COLOR_KEYS) {
      const v = colorsRaw[k];
      if (v === undefined) continue;
      if (!isNonEmptyString(v)) {
        problem(`semantic color "${k}" must be a non-empty string`);
        continue;
      }
      overrides[k] = v;
    }
    if (problems.length > 0 && problems[problems.length - 1].name === name) continue;
    const colors = resolveThemeColors(legacy, overrides);

    const spacing = isRecord(entry.spacing) ? (entry.spacing as Record<string, unknown>) : {};
    const panelPaddingX = spacing.panelPaddingX ?? DEFAULT_SPACING.panelPaddingX;
    const panelPaddingY = spacing.panelPaddingY ?? DEFAULT_SPACING.panelPaddingY;
    const cardPaddingX = spacing.cardPaddingX ?? DEFAULT_SPACING.cardPaddingX;
    const cardGap = spacing.cardGap ?? DEFAULT_SPACING.cardGap;
    const sectionGap = spacing.sectionGap ?? DEFAULT_SPACING.sectionGap;
    if (
      !isNonNegativeInt(panelPaddingX) || !isNonNegativeInt(panelPaddingY) ||
      !isNonNegativeInt(cardPaddingX) || !isNonNegativeInt(cardGap) || !isNonNegativeInt(sectionGap)
    ) {
      problem("spacing values must be non-negative integers");
      continue;
    }

    const typography = isRecord(entry.typography) ? (entry.typography as Record<string, unknown>) : {};
    const typographyDefaults: Record<string, string> = { ...DEFAULT_TYPOGRAPHY };
    const pickText = (key: string, fallback: string): string | null => {
      const v = typography[key] ?? typographyDefaults[key] ?? fallback;
      if (!isNonEmptyString(v)) {
        problem(`typography "${key}" must be a non-empty string`);
        return null;
      }
      return v;
    };
    const brandIcon = pickText("brandIcon", DEFAULT_TYPOGRAPHY.brandIcon);
    const brandName = pickText("brandName", DEFAULT_TYPOGRAPHY.brandName);
    const userPrefix = pickText("userPrefix", DEFAULT_TYPOGRAPHY.userPrefix);
    const assistantPrefix = pickText("assistantPrefix", DEFAULT_TYPOGRAPHY.assistantPrefix);
    const sectionDivider = pickText("sectionDivider", DEFAULT_TYPOGRAPHY.sectionDivider);
    if (
      brandIcon === null || brandName === null || userPrefix === null ||
      assistantPrefix === null || sectionDivider === null
    ) {
      continue;
    }

    const borders = isRecord(entry.borders) ? (entry.borders as Record<string, unknown>) : {};
    const panel = (borders.panel ?? DEFAULT_BORDERS.panel) as string;
    const card = (borders.card ?? DEFAULT_BORDERS.card) as string;
    const modal = (borders.modal ?? DEFAULT_BORDERS.modal) as string;
    if (!PANEL_BORDERS.includes(panel) || !CARD_BORDERS.includes(card) || !MODAL_BORDERS.includes(modal)) {
      problem("borders must be panel: round|single|double|bold, card: round|single|none, modal: round|double");
      continue;
    }

    const responsive = isRecord(entry.responsive) ? (entry.responsive as Record<string, unknown>) : {};
    const compactWidth = responsive.compactWidth ?? DEFAULT_RESPONSIVE.compactWidth;
    const normalWidth = responsive.normalWidth ?? DEFAULT_RESPONSIVE.normalWidth;
    const wideWidth = responsive.wideWidth ?? DEFAULT_RESPONSIVE.wideWidth;
    if (!isPositiveInt(compactWidth) || !isPositiveInt(normalWidth) || !isPositiveInt(wideWidth)) {
      problem("responsive widths must be positive integers");
      continue;
    }

    themes[name] = {
      colors,
      typography: { brandIcon, brandName, userPrefix, assistantPrefix, sectionDivider },
      spacing: { panelPaddingX, panelPaddingY, cardPaddingX, cardGap, sectionGap },
      borders: {
        panel: panel as PanelBorderStyle,
        card: card as CardBorderStyle,
        modal: modal as ModalBorderStyle,
      },
      responsive: { compactWidth, normalWidth, wideWidth },
    };
  }
  return { themes, problems };
}
