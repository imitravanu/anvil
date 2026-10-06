import { useCallback, useState } from "react";

/** Keyboard focus zone: where keystrokes land. Overlays own input while open. */
export type FocusZone = "input" | "transcript" | "overlay";

export interface FocusState {
  zone: FocusZone;
}

/** Pure transition, tested without React. Overlays always win when open. */
export function focusTransition(
  prev: FocusState,
  event:
    | { type: "tab"; overlaysOpen: boolean; slashMenuOpen: boolean }
    | { type: "escape" }
    | { type: "overlay"; open: boolean }
): FocusState {
  if (event.type === "overlay") {
    return { zone: event.open ? "overlay" : "input" };
  }
  if (event.type === "escape") {
    // Esc always lands back in the input (or stays there) — cancel first is
    // InputBar's job; the zone just follows.
    return prev.zone === "overlay" ? prev : { zone: "input" };
  }
  // Tab with the slash menu open fills the command (InputBar owns it) — never
  // steal it. Tab over an overlay belongs to the overlay. Otherwise toggle.
  if (event.overlaysOpen || event.slashMenuOpen) return prev;
  return { zone: prev.zone === "input" ? "transcript" : "input" };
}

/** Zone state for App: Tab toggles input↔transcript, overlays force overlay. */
export function useFocusZone(): {
  zone: FocusZone;
  onTab: (overlaysOpen: boolean, slashMenuOpen: boolean) => void;
  onEscape: () => void;
  onOverlaysChanged: (open: boolean) => void;
} {
  const [state, setState] = useState<FocusState>({ zone: "input" });
  const onTab = useCallback((overlaysOpen: boolean, slashMenuOpen: boolean) => {
    setState((prev) => focusTransition(prev, { type: "tab", overlaysOpen, slashMenuOpen }));
  }, []);
  const onEscape = useCallback(() => {
    setState((prev) => focusTransition(prev, { type: "escape" }));
  }, []);
  const onOverlaysChanged = useCallback((open: boolean) => {
    setState((prev) => focusTransition(prev, { type: "overlay", open }));
  }, []);
  return { zone: state.zone, onTab, onEscape, onOverlaysChanged };
}
