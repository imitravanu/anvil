/** SGR 1006 reports, both raw and with Ink's leading ESC stripped. */
export interface TerminalMouseEvent {
  direction: "up" | "down" | null;
  pointer?: "press" | "move" | "release";
  x?: number;
  y?: number;
}

export function terminalMouseInput(input: string): TerminalMouseEvent | null {
  const match = /^\u001b?\[<(\d+);(\d+);(\d+)([Mm])$/.exec(input);
  if (!match) return null;
  const [button, x, y] = match.slice(1, 4).map(Number);
  // Consume all mouse reports, but only scroll for valid vertical wheel presses.
  if (![button, x, y].every(Number.isSafeInteger) || x < 1 || y < 1 || button > 127) return { direction: null };
  const unmodified = button & ~(4 | 8 | 16); // Shift, Meta, Control flags
  if (unmodified === 0 || unmodified === 32) return { direction: null, pointer: match[4] === "m" ? "release" : unmodified === 32 ? "move" : "press", x: x - 1, y: y - 1 };
  return { direction: match[4] === "m" ? null : unmodified === 64 ? "up" : unmodified === 65 ? "down" : null };
}
