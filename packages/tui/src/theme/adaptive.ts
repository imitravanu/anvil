/**
 * DW-4.4 — terminal background detection (environment layer).
 * COLORFGBG ("<fg>;<bg>", 0-15 palette) is set by rxvt-likes and some
 * multiplexers: bg 0-6/8 → dark terminal, 7/15 → light. Anything else →
 * null (unknown — caller keeps its current default). The live OSC 11 probe
 * stays deferred: it needs raw-stdin ownership that Ink holds at runtime.
 * Pure over an injected env record; unit-tested without a terminal.
 */
export function detectTerminalTheme(env: Record<string, string | undefined> = process.env): "dark" | "light" | null {
  const raw = env.COLORFGBG;
  if (!raw) return null;
  const parts = raw.split(";");
  const bg = Number(parts[parts.length - 1]);
  if (!Number.isInteger(bg)) return null;
  if (bg === 7 || bg === 15) return "light";
  if ((bg >= 0 && bg <= 6) || bg === 8) return "dark";
  return null;
}
