// Registry of named themes. Components read colors via useTheme() — never
// import a theme object directly.
//
// DW-1 design system: 11 legacy color keys (stable file format for
// ~/.anvil/themes.json — old custom themes keep loading) + 15 semantic keys
// derived from them. Custom themes may override any semantic key, plus the
// typography / spacing / borders / responsive sections (all defaulted).

export type LegacyColorKey =
  | "primary" | "userText" | "assistantText" | "toolName" | "toolRunning"
  | "toolDone" | "toolError" | "dim" | "border" | "accent" | "surface";

/** Backwards-compatible alias: the file format's required keys. */
export type ThemeColorKey = LegacyColorKey;

export type SemanticColorKey =
  | "brand" | "brandDim"
  | "surfaceElevated" | "surfaceActive"
  | "textPrimary" | "textSecondary" | "textMuted" | "textUser" | "textAssistant"
  | "success" | "warning" | "error" | "info"
  | "borderFocus" | "separator"
  | "diffAddBg" | "diffDelBg";

export type AnyColorKey = LegacyColorKey | SemanticColorKey;

/** Every semantic key derives from one legacy key (migration map). */
export const SEMANTIC_DERIVATION: Record<SemanticColorKey, LegacyColorKey> = {
  brand: "primary",
  brandDim: "primary",
  surfaceElevated: "surface",
  surfaceActive: "surface",
  textPrimary: "userText",
  textSecondary: "dim",
  textMuted: "dim",
  textUser: "userText",
  textAssistant: "assistantText",
  success: "toolDone",
  warning: "toolRunning",
  error: "toolError",
  info: "primary",
  borderFocus: "border",
  separator: "dim",
  diffAddBg: "toolDone",
  diffDelBg: "toolError",
};

export const SEMANTIC_COLOR_KEYS: readonly SemanticColorKey[] = [
  "brand", "brandDim",
  "surfaceElevated", "surfaceActive",
  "textPrimary", "textSecondary", "textMuted", "textUser", "textAssistant",
  "success", "warning", "error", "info",
  "borderFocus", "separator",
  "diffAddBg", "diffDelBg",
];

export interface ThemeTypography {
  brandIcon: string;
  brandName: string;
  userPrefix: string;
  assistantPrefix: string;
  sectionDivider: string;
}

export type PanelBorderStyle = "round" | "single" | "double" | "bold";
export type CardBorderStyle = "round" | "single" | "none";
export type ModalBorderStyle = "round" | "double";

export interface ThemeBorders {
  panel: PanelBorderStyle;
  card: CardBorderStyle;
  modal: ModalBorderStyle;
}

export interface ThemeResponsive {
  compactWidth: number;
  normalWidth: number;
  wideWidth: number;
}

export interface ThemeSpacing {
  panelPaddingX: number;
  panelPaddingY: number;
  cardPaddingX: number;
  cardGap: number;
  sectionGap: number;
}

/** Structural theme shape — built-ins satisfy it, and so do validated custom themes. */
export interface Theme {
  colors: Record<AnyColorKey, string>;
  typography: ThemeTypography;
  spacing: ThemeSpacing;
  borders: ThemeBorders;
  responsive: ThemeResponsive;
}

export const REQUIRED_COLOR_KEYS: readonly LegacyColorKey[] = [
  "primary", "userText", "assistantText", "toolName", "toolRunning",
  "toolDone", "toolError", "dim", "border", "accent", "surface",
];

export const DEFAULT_TYPOGRAPHY: ThemeTypography = {
  brandIcon: "▲",
  brandName: "ANVIL",
  userPrefix: "❯ you",
  assistantPrefix: "anvil",
  sectionDivider: "─",
};

export const DEFAULT_SPACING: ThemeSpacing = {
  panelPaddingX: 1,
  panelPaddingY: 0,
  cardPaddingX: 2,
  cardGap: 1,
  sectionGap: 1,
};

export const DEFAULT_BORDERS: ThemeBorders = {
  panel: "round",
  card: "round",
  modal: "double",
};

export const DEFAULT_RESPONSIVE: ThemeResponsive = {
  compactWidth: 80,
  normalWidth: 120,
  wideWidth: 160,
};

/**
 * Build the full color record from legacy keys + optional semantic overrides.
 * Pure — the migration seam for old custom themes.
 */
export function resolveThemeColors(
  legacy: Record<LegacyColorKey, string>,
  overrides: Partial<Record<SemanticColorKey, string>> = {}
): Record<AnyColorKey, string> {
  const colors = { ...legacy } as Record<AnyColorKey, string>;
  for (const key of SEMANTIC_COLOR_KEYS) {
    const override = overrides[key];
    colors[key] = override !== undefined && override.length > 0 ? override : legacy[SEMANTIC_DERIVATION[key]];
  }
  return colors;
}

function makeTheme(
  legacy: Record<LegacyColorKey, string>,
  overrides: Partial<Record<SemanticColorKey, string>> = {}
): Theme {
  return {
    colors: resolveThemeColors(legacy, overrides),
    typography: { ...DEFAULT_TYPOGRAPHY },
    spacing: { ...DEFAULT_SPACING },
    borders: { ...DEFAULT_BORDERS },
    responsive: { ...DEFAULT_RESPONSIVE },
  };
}

export type ThemeName = "dark" | "light" | "highContrast" | "midnight" | "hacker" | "forge";

export const THEMES: Record<ThemeName, Theme> = {
  dark: makeTheme(
    {
      primary: "cyan",
      userText: "white",
      assistantText: "greenBright",
      toolName: "yellow",
      toolRunning: "magenta",
      toolDone: "green",
      toolError: "red",
      dim: "gray",
      border: "cyan",
      accent: "magenta",
      surface: "gray",
    },
    {
      brand: "#00d4ff",
      brandDim: "cyan",
      textSecondary: "gray",
      textMuted: "gray",
      info: "cyan",
      borderFocus: "cyanBright",
      separator: "gray",
      diffAddBg: "#1b3322",
      diffDelBg: "#331b1b",
    }
  ),
  light: makeTheme(
    {
      primary: "blue",
      userText: "black",
      assistantText: "green",
      toolName: "magenta",
      toolRunning: "yellow",
      toolDone: "green",
      toolError: "red",
      dim: "gray",
      border: "blue",
      accent: "magenta",
      surface: "gray",
    },
    {
      brand: "#0066cc",
      brandDim: "blue",
      info: "blue",
      borderFocus: "blueBright",
      separator: "gray",
      diffAddBg: "#d4edda",
      diffDelBg: "#f8d7da",
    }
  ),
  highContrast: makeTheme(
    {
      primary: "yellowBright",
      userText: "white",
      assistantText: "whiteBright",
      toolName: "cyanBright",
      toolRunning: "magentaBright",
      toolDone: "greenBright",
      toolError: "redBright",
      dim: "gray",
      border: "yellowBright",
      accent: "magentaBright",
      surface: "white",
    },
    {
      brand: "#ffff00",
      brandDim: "yellowBright",
      info: "cyanBright",
      borderFocus: "whiteBright",
      separator: "gray",
      // Minimum visible tint: this theme exists for legibility, so the tint
      // must never eat into the text/background contrast contract.
      diffAddBg: "#14331c",
      diffDelBg: "#331414",
    }
  ),
  midnight: makeTheme(
    {
      primary: "#7b68ee",
      userText: "white",
      assistantText: "#c0caf5",
      toolName: "yellow",
      toolRunning: "#e94560",
      toolDone: "green",
      toolError: "#e94560",
      dim: "gray",
      border: "#7b68ee",
      accent: "#e94560",
      surface: "#1a1a2e",
    },
    {
      brand: "#7b68ee",
      brandDim: "#5650a0",
      surfaceElevated: "#23233d",
      surfaceActive: "#2e2e4d",
      textSecondary: "#8a8aa3",
      textMuted: "#5c5c78",
      info: "#7b68ee",
      borderFocus: "#9d8fff",
      separator: "#3a3a5c",
      diffAddBg: "#153029",
      diffDelBg: "#341522",
    }
  ),
  hacker: makeTheme(
    {
      primary: "#00ff41",
      userText: "#00ff41",
      assistantText: "green",
      toolName: "yellow",
      toolRunning: "#00ff41",
      toolDone: "#00ff41",
      toolError: "red",
      dim: "gray",
      border: "#00ff41",
      accent: "#00ff41",
      surface: "black",
    },
    {
      brand: "#00ff41",
      brandDim: "green",
      surfaceElevated: "black",
      surfaceActive: "#0a1f0f",
      textSecondary: "#008f11",
      textMuted: "#003b00",
      info: "#00ff41",
      borderFocus: "greenBright",
      separator: "#003b00",
      diffAddBg: "#0a2e12",
      diffDelBg: "#2e0a0a",
    }
  ),
  // Phase 28.1: single-accent ember palette. The four text tiers are
  // deliberate — textPrimary is body text, textSecondary/textMuted stay
  // readable when quieted, and dim is decoration only (never readable text).
  forge: makeTheme(
    {
      primary: "#ff7a1f",
      userText: "#e4e6ea",
      assistantText: "#e4e6ea",
      toolName: "#e4e6ea",
      toolRunning: "#ff7a1f",
      toolDone: "#6fd08c",
      toolError: "#ff6b6b",
      dim: "#565c66",
      border: "#3a3f47",
      accent: "#ff7a1f",
      surface: "#2a2e33",
    },
    {
      brand: "#ff7a1f",
      brandDim: "#a35b1a",
      surfaceElevated: "#33373d",
      surfaceActive: "#3d4249",
      textPrimary: "#e4e6ea",
      textSecondary: "#a3aab4",
      textMuted: "#6b7280",
      textUser: "#e4e6ea",
      textAssistant: "#e4e6ea",
      success: "#6fd08c",
      warning: "#ffb347",
      error: "#ff6b6b",
      info: "#6cb4ff",
      borderFocus: "#ff7a1f",
      separator: "#3a3f47",
      diffAddBg: "#1b3322",
      diffDelBg: "#331b1b",
    }
  ),
};

export function isThemeName(name: string): name is ThemeName {
  return name in THEMES;
}
