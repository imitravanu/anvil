import { createContext, useContext } from "react";
import { useInput as useInkInput, usePaste as useInkPaste } from "ink";

/** Keep mounted UI state while a terminal is too small to show its controls. */
export const InputAvailabilityContext = createContext(true);

export function useInput(handler: Parameters<typeof useInkInput>[0], options: { isActive?: boolean } = {}): void {
  const available = useContext(InputAvailabilityContext);
  // Ink removes subscriptions in a passive effect; gate the callback too so
  // hidden controls cannot receive a key between commit and effect cleanup.
  useInkInput((input, key) => {
    if (available && options.isActive !== false) handler(input, key);
  }, { isActive: available && options.isActive !== false });
}

export function usePaste(handler: (text: string) => void, options: { isActive?: boolean } = {}): void {
  const available = useContext(InputAvailabilityContext);
  useInkPaste(text => {
    if (available && options.isActive !== false) handler(text);
  }, { isActive: available && options.isActive !== false });
}
