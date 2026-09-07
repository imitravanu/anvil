import { useEffect, useState } from "react";
import { Box, Text, useInput } from "ink";
import { THEMES, isThemeName } from "../theme/themes.js";
import { loadCustomThemes } from "../theme/custom.js";
import { useTheme } from "../theme/theme.js";

/**
 * Theme picker overlay (bare `/theme`): arrow through the theme list with a
 * LIVE preview — the whole UI repaints as you move — Enter applies and
 * persists, Esc restores what was active when the picker opened. Same
 * takes-over-input pattern as ModelPicker/SessionPicker.
 */
export function ThemePicker({
  onPreview,
  onApply,
  onCancel,
}: {
  onPreview: (name: string) => void;
  onApply: (name: string) => void;
  onCancel: () => void;
}) {
  const theme = useTheme();
  const [names] = useState<string[]>(() => [
    ...Object.keys(THEMES),
    ...Object.keys(loadCustomThemes().themes),
  ]);
  const [selected, setSelected] = useState(0);

  // Preview as the highlight moves (and once on mount).
  useEffect(() => {
    const name = names[selected];
    if (name) onPreview(name);
  }, [selected, names, onPreview]);

  useInput((_input, key) => {
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

  return (
    <Box flexDirection="column" flexShrink={0} borderStyle="round" borderColor={theme.colors.primary} paddingX={1}>
      <Text color={theme.colors.primary}>
        Select a theme — move to preview live, Enter to apply, Esc to keep the current one
      </Text>
      {names.map((name, i) => (
        <Text key={name} color={i === selected ? theme.colors.primary : theme.colors.userText}>
          {i === selected ? "❯ " : "  "}
          {name}
          {name === "light" ? " (for white/light background terminals)" : ""}
          {isThemeName(name) ? "" : " (custom)"}
        </Text>
      ))}
    </Box>
  );
}
