import { useCallback, useState } from "react";
import { loadSettings, saveSettings } from "@anvil/core";
import { THEMES, isThemeName, type Theme } from "../theme/themes.js";
import { loadCustomThemes } from "../theme/custom.js";

export interface UseThemeManagerOptions {
  initialTheme: string;
  printSystemMessage: (text: string) => void;
}

export interface UseThemeManagerResult {
  themeName: string;
  resolveTheme: (name: string) => Theme;
  applyTheme: (name: string) => void;
  /** Switch the UI immediately WITHOUT persisting — live preview in the picker. */
  previewTheme: (name: string) => void;
}

/**
 * Theme ownership extracted from App (P3 split): built-in + custom
 * resolution, validation, persistence. Returns live values every render.
 */
export function useThemeManager(opts: UseThemeManagerOptions): UseThemeManagerResult {
  const [themeName, setThemeName] = useState<string>(opts.initialTheme);
  // user themes from ~/.anvil/themes.json, loaded once. Built-ins win
  // on name conflicts (the loader rejects shadows; this is belt-and-braces).
  const [customThemes, setCustomThemes] = useState(() => loadCustomThemes());

  const resolveTheme = (name: string): Theme =>
    customThemes.themes[name] ?? (isThemeName(name) ? THEMES[name] : THEMES.dark);

  const applyTheme = (name: string) => {
    // Re-read custom themes on every invocation: users edit themes.json
    // without restarting, and a stale list would call their theme unknown.
    const fresh = loadCustomThemes();
    setCustomThemes(fresh);
    const names = [...Object.keys(THEMES), ...Object.keys(fresh.themes)];
    if (!name) {
      const problems = fresh.problems.map((p) => `${p.name}: ${p.error}`).join("; ");
      opts.printSystemMessage(
        `Usage: /theme <name>. Valid themes: ${names.join(", ")}.` +
        (problems ? ` Custom theme problems: ${problems}` : "")
      );
      return;
    }
    if (!isThemeName(name) && !(name in fresh.themes)) {
      opts.printSystemMessage(
        `Unknown theme "${name}". Valid themes: ${names.join(", ")}.`
      );
      return;
    }
    setThemeName(name);
    saveSettings({ ...loadSettings(), theme: name }); // persists across restarts
    opts.printSystemMessage(`Theme set to ${name}${isThemeName(name) ? "" : " (custom)"}.`);
  };

  /** Live preview: switches the whole UI but touches neither settings.json
   *  nor the transcript — the picker restores or applies on exit.
   *  Memoized: ThemePicker previews on selection change, and an unmemoized
   *  callback re-fired the effect (and re-rendered the whole UI) every render. */
  const previewTheme = useCallback(
    (name: string) => {
      if (isThemeName(name) || name in customThemes.themes) setThemeName(name);
    },
    [customThemes]
  );

  return { themeName, resolveTheme, applyTheme, previewTheme };
}
