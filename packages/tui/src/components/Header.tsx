import { Box, Text, useStdout } from "ink";
import { MODEL_REGISTRY, type SituationalContext } from "@anvil/core";
import { useTheme } from "../theme/theme.js";
import {
  curtail,
  displayModelLabel,
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
  const modelTag = `${provider} · ${modelName}${formatPricingTag(info?.isFree)} · ${state}`;

  // If width is narrow (< 80 columns) or context isn't loaded yet, render compact header
  if (width < 80 || !context) {
    const maxRight = Math.max(12, width - 20);
    return (
      <Box justifyContent="space-between" flexShrink={0} paddingX={theme.spacing.panelPaddingX}>
        <Text bold color={theme.colors.primary}>▲ ANVIL</Text>
        <Text dimColor>{curtail(modelTag, maxRight)}</Text>
      </Box>
    );
  }

  // Situational Cockpit Header
  const gitBranch = context.git
    ? `${context.git.branch}${context.git.clean ? "" : "*"}`
    : "no-git";
  const gitClean = context.git ? context.git.clean : true;

  const eco = context.ecosystem.packageManager
    ? `${context.ecosystem.type} (${context.ecosystem.packageManager})`
    : context.ecosystem.type;

  return (
    <Box justifyContent="space-between" flexShrink={0} paddingX={theme.spacing.panelPaddingX}>
      <Box gap={1}>
        <Text bold color={theme.colors.primary}>▲ ANVIL</Text>
        <Text dimColor>│</Text>
        <Text>
          <Text dimColor>repo: </Text>
          <Text bold>{curtail(context.projectName, 18)}</Text>
          <Text dimColor> (</Text>
          <Text color={gitClean ? theme.colors.toolDone : theme.colors.toolRunning}>
            {curtail(gitBranch, 16)}
          </Text>
          <Text dimColor>)</Text>
        </Text>
        <Text dimColor>│</Text>
        <Text>
          <Text dimColor>env: </Text>
          <Text>{curtail(eco, 16)}</Text>
        </Text>
        {context.ecosystem.testScript && width >= 105 && (
          <>
            <Text dimColor>│</Text>
            <Text>
              <Text dimColor>tests: </Text>
              <Text>{curtail(context.ecosystem.testScript, 18)}</Text>
            </Text>
          </>
        )}
        {context.projectRules && width >= 120 && (
          <>
            <Text dimColor>│</Text>
            <Text>
              <Text dimColor>rules: </Text>
              <Text color={theme.colors.accent}>{curtail(context.projectRules.source, 16)}</Text>
            </Text>
          </>
        )}
      </Box>
      <Box flexShrink={0}>
        <Text dimColor>{curtail(modelTag, Math.max(12, width - 60))}</Text>
      </Box>
    </Box>
  );
}
