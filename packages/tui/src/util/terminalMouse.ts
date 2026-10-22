/** SGR 1006 reports, both raw and with Ink's leading ESC stripped. */
export function terminalMouseInput(input: string): { direction: "up" | "down" | null } | null {
  const match = /^\u001b?\[<(\d+);(\d+);(\d+)([Mm])$/.exec(input);
  if (!match) return null;
  const [button, x, y] = match.slice(1, 4).map(Number);
  // Consume all mouse reports, but only scroll for valid vertical wheel presses.
  if (![button, x, y].every(Number.isSafeInteger) || x < 1 || y < 1 || button > 127 || match[4] !== "M") return { direction: null };
  const unmodified = button & ~(4 | 8 | 16); // Shift, Meta, Control flags
  return { direction: unmodified === 64 ? "up" : unmodified === 65 ? "down" : null };
}
