import type { ReactNode } from "react";
import { Box, Text, useStdout } from "ink";
import { MODEL_REGISTRY, type SituationalContext } from "@anvil/core";
import { useTheme } from "../theme/theme.js";
import {
  curtail,
  displayModelLabel,
  displayWidth,
  providerOfModel,
  providerLabel,
  formatPricingTag,
} from "../util/format.js";

export interface HeaderProps {
  model: string;
  isBusy: boolean;
  context?: SituationalContext;
}

export function Header({ model, isBusy, context }: HeaderProps) {
  const theme = useTheme();
  const { stdout } = useStdout();
  const width = stdout?.columns ?? 80;
  const info = MODEL_REGISTRY.find((m) => m.id === model);
  const provider = info ? providerLabel(providerOfModel(model) ?? info.providerId) : "Anvil";
  const modelName = displayModelLabel(model);
  const state = isBusy ? "busy" : "idle";
  const fullTag = `${provider} · ${modelName}${formatPricingTag(info?.isFree)} · ${state}`;
  // State and pricing already live in the StatusBar; when the full tag can't
  // fit, prefer dropping them over truncating the model name mid-word.
  const compactTag = `${provider} · ${modelName}`;

  // Longest tag that fits the budget; falls back to a hard curtail only when
  // even the compact form overflows. Never exceeds the budget, so the right
  // side can't push the left column (and the "▲ ANVIL" brand) off-screen.
  const fitTag = (budget: number): string => {
    if (displayWidth(fullTag) <= budget) return fullTag;
    if (displayWidth(compactTag) <= budget) return compactTag;
    return curtail(compactTag, budget);
  };

  // DW-2.1 cockpit frame: rounded border shared by both header modes.
  // Column direction is load-bearing: the default row direction would
  // shrink-wrap the inner space-between row to its content and the model
  // tag would ride against the segments instead of the right edge.
  const frame = (children: ReactNode) => (
    <Box
      flexDirection="column"
      flexShrink={0}
      borderStyle={theme.borders.panel}
      borderColor={theme.colors.border}
      paddingX={theme.spacing.panelPaddingX}
    >
      {children}
    </Box>
  );

  // Compact header: brand left, model tag right (no situational context yet or
  // a narrow terminal).
  if (width < 80 || !context) {
    return frame(
      <Box justifyContent="space-between" flexShrink={0} flexGrow={1}>
        <Text bold color={theme.colors.brand}>▲ ANVIL</Text>
        <Text dimColor>{fitTag(Math.max(12, width - 24))}</Text>
      </Box>
    );
  }

  // --- Situational Cockpit Header ---
  const gitBranch = context.git
    ? `${context.git.branch}${context.git.clean ? "" : "*"}`
    : "no-git";
  const gitClean = context.git ? context.git.clean : true;

  const eco = context.ecosystem.packageManager
    ? `${context.ecosystem.type} (${context.ecosystem.packageManager})`
    : context.ecosystem.type;

  // Adaptive left column: lower-priority segments drop as width narrows so the
  // model tag (the row the user actually reads) keeps the room. Below 92 the
  // tag would otherwise lose ~17 cells to "env:", so it goes first.
  const showTests = !!context.ecosystem.testScript && width >= 105;
  const showRules = !!context.projectRules && width >= 120;
  const showEnv = width >= 92;

  const nameV = curtail(context.projectName, 18);
  const branchV = curtail(gitBranch, 16);
  const ecoV = curtail(eco, 16);
  const testsV = context.ecosystem.testScript ? curtail(context.ecosystem.testScript, 18) : "";
  const rulesV = context.projectRules ? curtail(context.projectRules.source, 16) : "";

  // Deterministic left-column display width: brand then each segment separated
  // by the Box's 1-cell gap + the "│" divider. Computed verbatim from the same
  // strings the render path uses, so the model tag can be budgeted to exactly
  // the remainder without any Yoga shrink surprise (the "▲ ANVIL" wrap bug).
  const leftWidth = () => {
    let w = displayWidth("▲ ANVIL");
    const segment = (txt: string) => {
      w += 1 /* gap */ + displayWidth(txt);
    };
    segment("│");
    segment(`repo: ${nameV} (● ${branchV})`);
    if (showEnv) {
      segment("│");
      segment(`env: ${ecoV}`);
    }
    if (showTests) {
      segment("│");
      segment(`tests: ${testsV}`);
    }
    if (showRules) {
      segment("│");
      segment(`rules: ${rulesV}`);
    }
    return w;
  };
  // Frame border (2) + inner padding (2): the frame itself airs the edge, so
  // no extra breathing room — every cell counts at 100 columns.
  const rightReserve = 4;

  return frame(
    <Box justifyContent="space-between" flexShrink={0} flexGrow={1}>
      <Box gap={1}>
        <Text bold color={theme.colors.brand}>▲ ANVIL</Text>
        <Text color={theme.colors.separator}>│</Text>
        <Text>
          <Text dimColor>repo: </Text>
          <Text bold>{nameV}</Text>
          <Text dimColor> (</Text>
          {/* DW-2.1 status dot: ● green = clean, yellow = dirty. */}
          <Text color={gitClean ? theme.colors.success : theme.colors.warning}>● </Text>
          <Text color={gitClean ? theme.colors.success : theme.colors.warning}>
            {branchV}
          </Text>
          <Text dimColor>)</Text>
        </Text>
        {showEnv && (
          <>
            <Text dimColor>│</Text>
            <Text>
              <Text dimColor>env: </Text>
              <Text>{ecoV}</Text>
            </Text>
          </>
        )}
        {showTests && (
          <>
            <Text dimColor>│</Text>
            <Text>
              <Text dimColor>tests: </Text>
              <Text>{testsV}</Text>
            </Text>
          </>
        )}
        {showRules && (
          <>
            <Text dimColor>│</Text>
            <Text>
              <Text dimColor>rules: </Text>
              <Text color={theme.colors.accent}>{rulesV}</Text>
            </Text>
          </>
        )}
      </Box>
      {/* Shrink-proof + budgeted to the exact remainder: the left column can
          never be squeezed and the tag degrades gracefully on narrow widths. */}
      <Box flexShrink={0}>
        <Text dimColor>{fitTag(Math.max(16, width - leftWidth() - rightReserve))}</Text>
      </Box>
    </Box>
  );
}
