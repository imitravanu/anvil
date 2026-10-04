import type { ReactNode } from "react";
import { Box, Text, useStdout } from "ink";
import { useTheme } from "../theme/theme.js";
import { sectionRule } from "../util/chrome.js";

/**
 * Phase 41 — one frame for every keyboard-owning overlay.
 *
 * Before this, each overlay hand-rolled its own chrome: three different border
 * styles, header prose mixed with keyboard hints, and no section rule. The
 * frame now reads its border from `theme.borders.modal` (the token was
 * validated and unused), its padding from `theme.spacing`, and its rule from
 * `theme.typography.sectionDivider` — so a custom theme restyles every modal
 * at once, and every overlay opens with the same shape: bold title left,
 * keyboard contract right, rule, content.
 */
export function OverlayFrame({
  title,
  meta,
  hints,
  children,
}: {
  /** Overlay name, brand-tinted and bold. */
  title: string;
  /** Dim suffix on the title row — counts, filters, live state. */
  meta?: string;
  /** The keyboard contract, right-aligned on the title row. */
  hints?: string;
  children: ReactNode;
}) {
  const theme = useTheme();
  const { stdout } = useStdout();
  const width = stdout?.columns ?? 80;
  // Border columns (2) + inner padding: the rule lands exactly on the text
  // column, so it reads as a rule under the title rather than a ragged stub.
  const ruleWidth = Math.max(0, width - 2 - theme.spacing.panelPaddingX * 2);
  return (
    // DW-3.3 focus signal: the overlay owns keystrokes while mounted (borderFocus).
    <Box
      flexDirection="column"
      flexShrink={0}
      borderStyle={theme.borders.modal}
      borderColor={theme.colors.borderFocus}
      paddingX={theme.spacing.panelPaddingX}
    >
      <Box justifyContent="space-between" gap={1} flexShrink={0}>
        <Text bold color={theme.colors.brand}>
          {title}
          {meta ? <Text color={theme.colors.textSecondary}> {meta}</Text> : null}
        </Text>
        {hints ? <Text color={theme.colors.textSecondary}>{hints}</Text> : null}
      </Box>
      <Text color={theme.colors.separator}>
        {sectionRule(theme.typography.sectionDivider, ruleWidth)}
      </Text>
      {children}
    </Box>
  );
}
