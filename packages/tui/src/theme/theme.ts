// Single source of truth for colors and spacing. No component should hardcode
// a color string — a future theme switcher (Phase 6) swaps this one object.
export const theme = {
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
  },
  spacing: {
    panelPaddingX: 1,
    panelPaddingY: 0,
  },
} as const;
