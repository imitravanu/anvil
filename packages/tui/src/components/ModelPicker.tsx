import { useEffect, useMemo, useState } from "react";
import { Box, Text, useInput } from "ink";
import type { ModelInfo, ModelProvider, ProviderId } from "@anvil/core";
import {
  DEFAULT_SYNC_TTL_MS,
  MODEL_REGISTRY,
  createOpenRouterFreeSource,
  isModelsCacheFresh,
  isRateLimited,
  syncFreeModels,
} from "@anvil/core";
import { useTheme } from "../theme/theme.js";

interface PickerRow {
  model: ModelInfo;
  enabled: boolean;
  provider: ModelProvider;
  providerDisplayName: string;
}

const MAX_VISIBLE = 8;

/**
 * Model/provider picker overlay. Takes over keyboard input while open.
 * Providers without a configured key are dimmed and skipped on navigation.
 * Windowed with scrolling to accommodate large model registries cleanly.
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
  const [models, setModels] = useState<ModelInfo[]>(() => [...MODEL_REGISTRY]);
  // Phase 8 (B): surface staleness instead of hiding it.
  const [cacheNote, setCacheNote] = useState<string | null>(() =>
    isModelsCacheFresh(DEFAULT_SYNC_TTL_MS) ? null : "Free-model list is stale — prices may be out of date."
  );

  // Phase 8 (B): the coordinator is the single owner — single-flight + TTL mean
  // this can never double-fetch; a failure is reported, never swallowed.
  useEffect(() => {
    let active = true;
    if (providers.openrouter?.isConfigured()) {
      syncFreeModels({ sources: [createOpenRouterFreeSource()] }).then((report) => {
        if (!active) return;
        setModels([...MODEL_REGISTRY]);
        if (report.refreshedAt) setCacheNote(null);
        else if (report.errors.length > 0) {
          setCacheNote("Free-model sync failing — prices may be out of date.");
        }
      });
    }
    return () => {
      active = false;
    };
  }, [providers]);

  const rows: PickerRow[] = useMemo(
    () =>
      models.map((m) => {
        const provider = providers[m.providerId as ProviderId];
        return {
          model: m,
          enabled: provider?.isConfigured() ?? false,
          provider,
          providerDisplayName: provider?.displayName ?? m.providerId,
        };
      }),
    [models, providers]
  );

  // Focus current model if enabled, otherwise first enabled row
  const [selected, setSelected] = useState(() => {
    const currentIdx = rows.findIndex((r) => r.model.id === currentModelId && r.enabled);
    if (currentIdx !== -1) return currentIdx;
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

  const scrollOffset = useMemo(() => {
    if (rows.length <= MAX_VISIBLE) return 0;
    const half = Math.floor(MAX_VISIBLE / 2);
    let start = selected - half;
    if (start < 0) start = 0;
    if (start + MAX_VISIBLE > rows.length) start = rows.length - MAX_VISIBLE;
    return start;
  }, [selected, rows.length]);

  const visibleRows = useMemo(() => {
    return rows.slice(scrollOffset, scrollOffset + MAX_VISIBLE);
  }, [rows, scrollOffset]);

  const hasAbove = scrollOffset > 0;
  const hasBelow = scrollOffset + MAX_VISIBLE < rows.length;

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.colors.primary} paddingX={1}>
      <Text color={theme.colors.primary}>
        Select a model ({selected + 1}/{rows.length}) — models with [FREE] cost $0 — Enter to switch, Esc to cancel
      </Text>
      {cacheNote && <Text dimColor>⚠ {cacheNote}</Text>}
      {hasAbove && (
        <Text dimColor>  ▲ {scrollOffset} more above...</Text>
      )}
      {visibleRows.map((row, i) => {
        const globalIndex = scrollOffset + i;
        const isSelected = globalIndex === selected;
        const isCurrent = row.model.id === currentModelId;
        const marker = isSelected ? "❯ " : "  ";
        const isFree = row.model.isFree;
        const isPaid = row.model.isFree === false;
        const pricingTag = isFree ? " [FREE]" : isPaid ? " [PAID]" : "";
        const limited = isRateLimited(row.model.providerId, row.model.id);

        if (!row.enabled) {
          return (
            <Text key={row.model.id} dimColor>
              {marker}
              {row.providerDisplayName} · {row.model.displayName}
              {pricingTag} {limited ? "[rate-limited] " : ""}(no API key)
            </Text>
          );
        }
        return (
          <Text key={row.model.id} color={isSelected ? theme.colors.primary : undefined}>
            {marker}
            {row.providerDisplayName} · {row.model.displayName}
            {isFree ? (
              <Text color={theme.colors.toolDone} bold> [FREE]</Text>
            ) : isPaid ? (
              <Text dimColor> [PAID]</Text>
            ) : null}
            {limited ? <Text dimColor> [rate-limited]</Text> : null}
            {isCurrent ? " (current)" : ""}
          </Text>
        );
      })}
      {hasBelow && (
        <Text dimColor>  ▼ {rows.length - (scrollOffset + MAX_VISIBLE)} more below...</Text>
      )}
    </Box>
  );
}