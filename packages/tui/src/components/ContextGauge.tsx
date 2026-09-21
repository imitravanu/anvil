import { Text } from "ink";
import { useTheme } from "../theme/theme.js";
import { meter } from "../util/chrome.js";
import { useBlink } from "../util/useSpinner.js";

/**
 * DW-4.2 — adaptive context gauge.
 * wide (120+):  bar + pct + absolute counts · normal: bar + pct · compact: pct.
 * Semantic colors; past 90% the color alternates red/amber with the blink
 * phase (amber, not red, off-phase — described correctly here because the
 * earlier "steady red" wording disagreed with the code below).
 */
export type GaugeVariant = "wide" | "normal" | "compact";

export function gaugeVariantForWidth(width: number): GaugeVariant {
  if (width >= 120) return "wide";
  if (width >= 80) return "normal";
  return "compact";
}

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return `${n}`;
}

/**
 * Plain-text form of the gauge for width budgeting (mirrors the render
 * exactly — same variant thresholds, bar widths, and counts).
 */
export function gaugeDisplayText(
  inputTokens: number,
  contextWindow: number | undefined,
  width: number
): string | null {
  if (!contextWindow || contextWindow <= 0) return null;
  const fraction = Math.max(0, Math.min(1, inputTokens / contextWindow));
  const pct = `${Math.round(fraction * 100)}%`;
  const variant = gaugeVariantForWidth(width);
  const bar = meter(fraction, variant === "wide" ? 10 : 6);
  if (variant === "wide") {
    return `${bar} ${pct} (${formatCount(inputTokens)} / ${formatCount(contextWindow)})`;
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
  const text = gaugeDisplayText(inputTokens, contextWindow, width) ?? pct;
  return <Text color={color}>{text}</Text>;
}
