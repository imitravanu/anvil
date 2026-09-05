// Registry of named themes. Components read colors via useTheme() — never
// import a theme object directly (Phase 6).
export const THEMES = {
  dark: {
    colors: {
      primary: "cyan",
      userText: "white",
      assistantText: "greenBright",
      toolName: "yellow",
      toolRunning: "yellow",
      toolDone: "green",
      toolError: "red",
      dim: "gray",
      border: "cyan",
      // Phase 8 (C6): surface hierarchy tokens.
      accent: "cyan",
      surface: "gray",
    },
    spacing: { panelPaddingX: 1, panelPaddingY: 0 },
  },
  light: {
    colors: {
      primary: "blue",
      userText: "black",
      assistantText: "green",
      toolName: "magenta",
      toolRunning: "yellow",
      toolDone: "green",
      toolError: "red",
      dim: "gray",
      border: "blue",
      accent: "blue",
      surface: "gray",
    },
    spacing: { panelPaddingX: 1, panelPaddingY: 0 },
  },
  highContrast: {
    colors: {
      primary: "yellowBright",
      userText: "white",
      assistantText: "whiteBright",
      toolName: "cyanBright",
      toolRunning: "yellowBright",
      toolDone: "greenBright",
      toolError: "redBright",
      dim: "gray",
      border: "yellowBright",
      accent: "yellowBright",
      surface: "white",
    },
    spacing: { panelPaddingX: 1, panelPaddingY: 0 },
  },
} as const;

export type ThemeName = keyof typeof THEMES;

export type ThemeColorKey =
  | "primary" | "userText" | "assistantText" | "toolName" | "toolRunning"
  | "toolDone" | "toolError" | "dim" | "border" | "accent" | "surface";

/** Structural theme shape — built-ins satisfy it, and so do validated custom themes (U13). */
export interface Theme {
  colors: Record<ThemeColorKey, string>;
  spacing: { panelPaddingX: number; panelPaddingY: number };
}

export const REQUIRED_COLOR_KEYS: readonly ThemeColorKey[] = [
  "primary", "userText", "assistantText", "toolName", "toolRunning",
  "toolDone", "toolError", "dim", "border", "accent", "surface",
];

export function isThemeName(name: string): name is ThemeName {
  return name in THEMES;
}