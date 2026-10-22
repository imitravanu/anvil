import type { RenderOptions } from "ink";

export const interactiveRenderOptions = {
  exitOnCtrlC: false,
  incrementalRendering: true,
  // Ink 7's auto probe replays early typing; Ctrl+J and legacy keys need no probe.
  kittyKeyboard: { mode: "disabled" },
} satisfies RenderOptions;
