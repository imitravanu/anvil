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
import { groupByProvider } from "../util/grouping.js";
import { formatPricingTag, pricingKind } from "../util/format.js";
import { MAX_VISIBLE_ROWS } from "../util/displayLimits.js";
import { useWindowedList } from "../hooks/useWindowedList.js";

interface PickerRow {
  model: ModelInfo;
  enabled: boolean;
  provider: ModelProvider;
  providerDisplayName: string;
}

const MAX_VISIBLE = MAX_VISIBLE_ROWS;

/**
 * Model/provider picker overlay. Takes over keyboard input while open.
 * Providers without a configured key are dimmed and skipped on navigation.
 * rows render grouped under provider headers (canonical provider order,
 * free-first inside each group); navigation follows display order. Windowed
 * with scrolling to accommodate large model registries cleanly.
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
  // Type-to-filter: a registry of 40+ models is un-navigable with arrows
  // alone. Printable keys extend the filter, Backspace retracts, Esc clears
  // it first and closes only when empty.
  const [filter, setFilter] = useState("");
  // surface staleness instead of hiding it.
  const [cacheNote, setCacheNote] = useState<string | null>(() =>
    isModelsCacheFresh(DEFAULT_SYNC_TTL_MS) ? null : "Free-model list is stale — prices may be out of date."
  );

  // the coordinator is the single owner — single-flight + TTL mean
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

  // Filter after the live-sync state, before grouping/navigation.
  const filteredModels = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return models;
    return models.filter(
      (m) =>
        m.displayName.toLowerCase().includes(q) || m.id.toLowerCase().includes(q) || m.providerId.toLowerCase().includes(q)
    );
  }, [models, filter]);

  const rows: PickerRow[] = useMemo(
    () =>
      filteredModels.map((m) => {
        const provider = providers[m.providerId as ProviderId];
        return {
          model: m,
          enabled: provider?.isConfigured() ?? false,
          provider,
          providerDisplayName: provider?.displayName ?? m.providerId,
        };
      }),
    [filteredModels, providers]
  );

  // canonical display order — provider sections, free-first within each.
  // Navigation, selection, and windowing all run over this order so the
  // highlight always matches what is on screen.
  const ordered = useMemo(() => {
    const sections = groupByProvider(
      rows,
      (r) => r.model.providerId,
      (r) => r.model.isFree
    );
    return sections.flatMap((s) =>
      s.entries.map((e) => ({ ...e, sectionSize: s.entries.length }))
    );
  }, [rows]);

  const [selected, setSelected] = useState(0);

  // Focus the current model if enabled, otherwise the first enabled row.
  // Re-runs when the filter changes so the highlight lands on a visible row.
  useEffect(() => {
    const currentIdx = ordered.findIndex((o) => o.row.model.id === currentModelId && o.row.enabled);
    if (currentIdx !== -1) {
      setSelected(currentIdx);
      return;
    }
    const first = ordered.findIndex((o) => o.row.enabled);
    setSelected(first === -1 ? 0 : first);
  }, [ordered, currentModelId]);

  useInput((input, key) => {
    if (key.escape) {
      if (filter) setFilter(""); // filter first, close second
      else onClose();
      return;
    }
    if (key.backspace) {
      setFilter((f) => f.slice(0, -1));
      return;
    }
    if (!key.upArrow && !key.downArrow && !key.return && !key.tab && input && input.length === 1 && input >= " " && !key.ctrl && !key.meta) {
      setFilter((f) => f + input);
      return;
    }
    if (key.upArrow || key.downArrow) {
      const dir = key.upArrow ? -1 : 1;
      let next = selected;
      // Skip over disabled (unconfigured) entries rather than selecting them
      for (let i = 0; i < ordered.length; i++) {
        next = (next + dir + ordered.length) % ordered.length;
        if (ordered[next].row.enabled) break;
      }
      setSelected(next);
    } else if (key.return) {
      const entry = ordered[selected];
      if (entry?.row.enabled) onSelect(entry.row.provider, entry.row.model);
    }
  });

  const { offset: scrollOffset, hasAbove, hasBelow } = useWindowedList(ordered.length, selected);

  const visible = useMemo(() => {
    return ordered
      .slice(scrollOffset, scrollOffset + MAX_VISIBLE)
      .map((entry, i) => ({ ...entry, pos: scrollOffset + i }));
  }, [ordered, scrollOffset]);

  const renderRow = (entry: (typeof visible)[number]) => {
    const { row, pos } = entry;
    const isSelected = pos === selected;
    const isCurrent = row.model.id === currentModelId;
    const marker = isSelected ? "❯ " : "  ";
    const kind = pricingKind(row.model.isFree);
    // The live sync names include "(Free)" — the [FREE] tag would duplicate it.
    const nameAlreadySaysFree = /\(free\)/i.test(row.model.displayName);
    const pricingTag = nameAlreadySaysFree ? "" : formatPricingTag(row.model.isFree);
    const limited = isRateLimited(row.model.providerId, row.model.id);

    if (!row.enabled) {
      return (
        <Text key={row.model.id} color={theme.colors.dim}>
          {marker}
          {row.model.displayName}
          {pricingTag} {limited ? "[rate-limited] " : ""}(no API key)
        </Text>
      );
    }
    return (
      <Text key={row.model.id} color={isSelected ? theme.colors.primary : theme.colors.userText}>
        {marker}
        {row.model.displayName}
        {kind === "free" ? (
          <Text color={theme.colors.toolDone} bold> [FREE]</Text>
        ) : kind === "paid" ? (
          <Text color={theme.colors.dim}> [PAID]</Text>
        ) : null}
        {limited ? <Text color={theme.colors.toolRunning}> [rate-limited]</Text> : null}
        {isCurrent ? " (current)" : ""}
      </Text>
    );
  };

  // Group the visible window under section headers (headers are display-only,
  // never selectable — navigation above already skips disabled rows).
  const grouped: { header: string; key: string; rows: typeof visible }[] = [];
  for (const entry of visible) {
    const last = grouped[grouped.length - 1];
    if (last && last.key === entry.row.model.providerId) {
      last.rows.push(entry);
    } else {
      grouped.push({
        header: `${entry.row.providerDisplayName} · ${entry.sectionSize}`,
        key: entry.row.model.providerId,
        rows: [entry],
      });
    }
  }

  return (
    <Box flexDirection="column" flexShrink={0} borderStyle="round" borderColor={theme.colors.primary} paddingX={1}>
      <Text color={theme.colors.primary}>
        Select a model ({selected + 1}/{ordered.length}) — type to filter, Enter to switch, Esc to cancel
      </Text>
      {filter && (
        <Text dimColor>
          filter: <Text color={theme.colors.toolName}>{filter}</Text> — Backspace to erase, Esc to clear
        </Text>
      )}
      {cacheNote && <Text dimColor>⚠ {cacheNote}</Text>}
      {hasAbove && (
        <Text dimColor>  ▲ {scrollOffset} more above...</Text>
      )}
      {grouped.map((section) => (
        <Box key={section.key} flexDirection="column">
          <Text dimColor>─ {section.header} ─</Text>
          {section.rows.map(renderRow)}
        </Box>
      ))}
      {hasBelow && (
        <Text dimColor>  ▼ {ordered.length - (scrollOffset + MAX_VISIBLE)} more below...</Text>
      )}
    </Box>
  );
}
