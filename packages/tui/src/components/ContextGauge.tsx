import { Text } from "ink";
import { useTheme } from "../theme/theme.js";
import { DEFAULT_RESPONSIVE, type ThemeResponsive } from "../theme/themes.js";
import { styledMeter, type MeterStyle } from "../util/chrome.js";
import { formatTokenCount } from "../util/format.js";
import { useBlink } from "../util/useSpinner.js";

/**
 * DW-4.2 — adaptive context gauge.
 * wide (normalWidth+):  bar + pct + absolute counts · normal: bar + pct · compact: pct.
 * Semantic colors; past 90% the color alternates red/amber with the blink
 * phase (amber, not red, off-phase — described correctly here because the
 * earlier "steady red" wording disagreed with the code below).
 */
export type GaugeVariant = "wide" | "normal" | "compact";

/**
 * Takeover 2026-10-10: the variant ladder reads the theme's `responsive`
 * tokens instead of hardcoded 80/120 — the tokens were validated for custom
 * themes and then ignored here, so a custom theme moved the status bar's
 * compact collapse (the one breakpointForWidth consumer) while the gauge kept
 * switching at the defaults: visibly desynced chrome.
 */
export function gaugeVariantForWidth(width: number, responsive: ThemeResponsive = DEFAULT_RESPONSIVE): GaugeVariant {
  if (width >= responsive.normalWidth) return "wide";
  if (width >= responsive.compactWidth) return "normal";
  return "compact";
}

/**
 * Plain-text form of the gauge for width budgeting (mirrors the render
 * exactly — same variant thresholds, bar widths, and counts).
 */
export function gaugeDisplayText(
  inputTokens: number,
  contextWindow: number | undefined,
  width: number,
  meterStyle: MeterStyle = "block",
  responsive: ThemeResponsive = DEFAULT_RESPONSIVE
): string | null {
  if (!contextWindow || contextWindow <= 0) return null;
  const fraction = Math.max(0, Math.min(1, inputTokens / contextWindow));
  const pct = `${Math.round(fraction * 100)}%`;
  const variant = gaugeVariantForWidth(width, responsive);
  const bar = styledMeter(meterStyle, fraction, variant === "wide" ? 10 : 6);
  if (variant === "wide") {
    return `${bar} ${pct} (${formatTokenCount(inputTokens)} / ${formatTokenCount(contextWindow)})`;
  }
  if (variant === "normal") return `${bar} ${pct}`;
  return pct;
}

export function ContextGauge({
  inputTokens,
  contextWindow,
  width,
}: {
  inputTokens: number;
  contextWindow: number | undefined;
  width: number;
}) {
  const theme = useTheme();
  const fraction =
    !contextWindow || contextWindow <= 0 ? 0 : Math.max(0, Math.min(1, inputTokens / contextWindow));
  // Timer only exists past 90% — no idle rerender churn below it.
  const blinkOn = useBlink(fraction >= 0.9);
  if (!contextWindow || contextWindow <= 0) return null;
  const pct = `${Math.round(fraction * 100)}%`;
  const critical = fraction >= 0.9;
  const color = critical
    ? blinkOn
      ? theme.colors.error
      : theme.colors.warning
    : fraction >= 0.75
      ? theme.colors.error
      : fraction >= 0.5
        ? theme.colors.warning
        : theme.colors.success;
  const text = gaugeDisplayText(inputTokens, contextWindow, width, theme.chrome.meterStyle, theme.responsive) ?? pct;
  return <Text color={color}>{text}</Text>;
}
