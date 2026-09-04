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
      dim: "white",
      border: "yellowBright",
      accent: "yellowBright",
      surface: "white",
    },
    spacing: { panelPaddingX: 1, panelPaddingY: 0 },
  },
} as const;

export type ThemeName = keyof typeof THEMES;
export type Theme = (typeof THEMES)[ThemeName];

export function isThemeName(name: string): name is ThemeName {
  return name in THEMES;
}