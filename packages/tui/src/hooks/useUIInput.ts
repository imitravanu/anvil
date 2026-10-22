import { createContext, useContext } from "react";
import { useInput as useInkInput, usePaste as useInkPaste } from "ink";
import { terminalMouseInput } from "../util/terminalMouse.js";
import { TERMINAL_WHEEL_ROWS } from "../util/displayLimits.js";

/** Keep mounted UI state while a terminal is too small to show its controls. */
export const InputAvailabilityContext = createContext(true);

export function useInput(handler: Parameters<typeof useInkInput>[0], options: { isActive?: boolean } = {}): void {
  const available = useContext(InputAvailabilityContext);
  // Ink removes subscriptions in a passive effect; gate the callback too so
  // hidden controls cannot receive a key between commit and effect cleanup.
  useInkInput((input, key) => {
    if (available && options.isActive !== false && !terminalMouseInput(input)) handler(input, key);
  }, { isActive: available && options.isActive !== false });
}

/** Wheel routing is separate from text/key input and never interprets paste. */
export function useWheel(handler: (rows: number) => void, options: { isActive?: boolean } = {}): void {
  const available = useContext(InputAvailabilityContext);
  useInkInput(input => {
    if (!available || options.isActive === false) return;
    const event = terminalMouseInput(input);
    if (event?.direction) handler(event.direction === "up" ? TERMINAL_WHEEL_ROWS : -TERMINAL_WHEEL_ROWS);
  }, { isActive: available && options.isActive !== false });
}

export function usePaste(handler: (text: string) => void, options: { isActive?: boolean } = {}): void {
  const available = useContext(InputAvailabilityContext);
  useInkPaste(text => {
    if (available && options.isActive !== false) handler(text);
  }, { isActive: available && options.isActive !== false });
}
