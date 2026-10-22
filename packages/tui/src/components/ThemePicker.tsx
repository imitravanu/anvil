import { useEffect, useMemo, useState } from "react";
import { Box, Text, useStdout } from "ink";
import { useInput, usePaste } from "../hooks/useUIInput.js";
import { THEMES, isThemeName, type Theme } from "../theme/themes.js";
import { loadCustomThemes } from "../theme/custom.js";
import { useTheme } from "../theme/theme.js";
import { MAX_VISIBLE_ROWS } from "../util/displayLimits.js";
import { useWindowedList } from "../hooks/useWindowedList.js";
import { OverlayFrame } from "./OverlayFrame.js";

/**
 * Theme picker overlay (bare `/theme`): arrow through the theme list with a
 * LIVE preview — the whole UI repaints as you move — Enter applies and
 * persists, Esc restores what was active when the picker opened.
 *
 * Phase 41: the list is windowed (a generous ~/.anvil/themes.json could
 * overflow the fixed frame, the class of bug the pickers already guard
 * against), and every row carries the theme's own brand swatch so themes are
 * recognizable at a glance instead of by name alone.
 */
export function ThemePicker({
  minimal = false,
  currentThemeName = "dark",
  onPreview,
  onApply,
  onCancel,
}: {
  minimal?: boolean;
  currentThemeName?: string;
  onPreview: (name: string) => void;
  onApply: (name: string) => void;
  onCancel: () => void;
}) {
  const theme = useTheme();
  const { stdout } = useStdout();
  const visibleRows = minimal ? Math.max(1, Math.min(MAX_VISIBLE_ROWS, (stdout?.rows ?? 24) - 10)) : MAX_VISIBLE_ROWS;
  // Loaded once per mount (initializer): re-reading themes.json on every
  // parent re-render would rescan the disk on each spinner tick.
  const [customs] = useState<Record<string, Theme>>(() => loadCustomThemes().themes);
  const names = useMemo(() => [...Object.keys(THEMES), ...Object.keys(customs)], [customs]);
  const [selected, setSelected] = useState(() => Math.max(0, names.indexOf(currentThemeName)));

  // Preview as the highlight moves (and once on mount).
  useEffect(() => {
    const name = names[selected];
    if (name) onPreview(name);
  }, [selected, names, onPreview]);

  usePaste(() => { /* intentional: applying a theme requires a typed selection. */ });
  useInput((_input, key) => {
    if (key.ctrl || key.meta) return;
    if (key.escape) {
      onCancel();
      return;
    }
    if (key.upArrow) setSelected((s) => Math.max(0, s - 1));
    else if (key.downArrow) setSelected((s) => Math.min(names.length - 1, s + 1));
    else if (key.return) {
      const name = names[selected];
      if (name) onApply(name);
    }
  });

  const { offset, hasAbove, hasBelow } = useWindowedList(names.length, selected, visibleRows);
  const visible = names.slice(offset, offset + visibleRows);

  // The row's swatch color comes from THAT theme's brand token — a theme is
  // previewed by name, but previewed at a glance here. Custom themes carry the
  // same resolved color record as built-ins.
  const swatchOf = (name: string): string =>
    (isThemeName(name) ? THEMES[name] : customs[name])?.colors.brand ?? theme.colors.brand;

  return (
    <OverlayFrame
      minimal={minimal}
      title="Themes"
      meta={`(${selected + 1}/${names.length})`}
      hints="↑/↓ live preview · Enter apply · Esc keep current"
    >
      {hasAbove && <Text color={theme.colors.textSecondary}>  ▲ {offset} more above…</Text>}
      {visible.map((name, i) => {
        const globalIndex = offset + i;
        const isSelected = globalIndex === selected;
        return (
          <Text key={name} color={isSelected ? theme.colors.primary : theme.colors.userText} wrap={minimal ? "truncate-end" : "wrap"}>
            {isSelected ? "❯ " : "  "}
            <Text color={swatchOf(name)}>● </Text>
            {name}
            {name === "light" ? " (for white/light background terminals)" : ""}
            {isThemeName(name) ? "" : " (custom)"}
          </Text>
        );
      })}
      {hasBelow && (
        <Text color={theme.colors.textSecondary}>
          ▼ {names.length - (offset + visibleRows)} more below…
        </Text>
      )}
    </OverlayFrame>
  );
}
