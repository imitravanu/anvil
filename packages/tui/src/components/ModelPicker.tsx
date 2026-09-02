import { useMemo, useState } from "react";
import { Box, Text, useInput } from "ink";
import type { ModelInfo, ModelProvider, ProviderId } from "@anvil/core";
import { MODEL_REGISTRY } from "@anvil/core";
import { useTheme } from "../theme/theme.js";

interface PickerRow {
  model: ModelInfo;
  enabled: boolean;
  provider: ModelProvider;
  providerDisplayName: string;
}

/**
 * Model/provider picker overlay. Takes over keyboard input while open.
 * Providers without a configured key are dimmed and skipped on navigation.
 */
export function ModelPicker({
  providers,
  currentModelId,
  onSelect,
  onClose,
}: {
  providers: Record<ProviderId, ModelProvider>;
  currentModelId: string;
  onSelect: (provider: ModelProvider, model: ModelInfo) => void;
  onClose: () => void;
}) {
  const theme = useTheme();
  const rows: PickerRow[] = useMemo(
    () =>
      MODEL_REGISTRY.map((m) => {
        const provider = providers[m.providerId as ProviderId];
        return {
          model: m,
          enabled: provider.isConfigured(),
          provider,
          providerDisplayName: provider.displayName,
        };
      }),
    [providers]
  );

  // First enabled row starts selected
  const [selected, setSelected] = useState(() => {
    const first = rows.findIndex((r) => r.enabled);
    return first === -1 ? 0 : first;
  });

  useInput((_input, key) => {
    if (key.escape) {
      onClose();
      return;
    }
    if (key.upArrow || key.downArrow) {
      const dir = key.upArrow ? -1 : 1;
      let next = selected;
      // Skip over disabled (unconfigured) entries rather than selecting them
      for (let i = 0; i < rows.length; i++) {
        next = (next + dir + rows.length) % rows.length;
        if (rows[next].enabled) break;
      }
      setSelected(next);
    } else if (key.return) {
      const row = rows[selected];
      if (row?.enabled) onSelect(row.provider, row.model);
    }
  });

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.colors.primary} paddingX={1}>
      <Text color={theme.colors.primary}>Select a model — Enter to switch, Esc to cancel</Text>
      {rows.map((row, i) => {
        const isSelected = i === selected;
        const isCurrent = row.model.id === currentModelId;
        const marker = isSelected ? "❯ " : "  ";
        if (!row.enabled) {
          return (
            <Text key={row.model.id} dimColor>
              {marker}
              {row.providerDisplayName} · {row.model.displayName} (no API key)
            </Text>
          );
        }
        return (
          <Text key={row.model.id} color={isSelected ? theme.colors.primary : undefined}>
            {marker}
            {row.providerDisplayName} · {row.model.displayName}
            {isCurrent ? " (current)" : ""}
          </Text>
        );
      })}
    </Box>
  );
}