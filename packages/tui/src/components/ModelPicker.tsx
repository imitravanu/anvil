import { useEffect, useMemo, useRef, useState } from "react";
import { Box, Text, useStdout } from "ink";
import { useInput, usePaste } from "../hooks/useUIInput.js";
import type { ModelInfo, ModelProvider, ProviderId } from "@anvil/core";
import {
  DEFAULT_SYNC_TTL_MS,
  createOpenRouterFreeSource,
  createOrcarouterFreeSource,
  isModelsCacheFresh,
  isRateLimited,
  syncFreeModels,
  visibleModels,
  refreshCustomProviderModels,
  loadCustomProviders,
  getErrorMessage,
} from "@anvil/core";
import { useTheme } from "../theme/theme.js";
import { sectionRule } from "../util/chrome.js";
import { OverlayFrame } from "./OverlayFrame.js";
import { TextDetail } from "./TextDetail.js";
import { groupByProvider } from "../util/grouping.js";
import { formatCertificationBadge, formatPricingTag, pricingKind } from "../util/format.js";
import { sanitizeTerminalText } from "../util/sanitize.js";
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
  minimal = false,
  onConnect,
  providers,
  currentModelId,
  currentProviderId,
  onSelect,
  onClose,
}: {
  minimal?: boolean;
  onConnect?: () => void;
  providers: Record<ProviderId, ModelProvider>;
  currentModelId: string;
  currentProviderId?: ProviderId;
  onSelect: (provider: ModelProvider, model: ModelInfo) => void;
  onClose: () => void;
}) {
  const theme = useTheme();
  const { stdout } = useStdout();
  const [showAll, setShowAll] = useState(false);
  const selection = useRef<string | null>(null);
  const [detail, setDetail] = useState<string | null>(null);
  const maxVisible = minimal ? Math.max(1, Math.min(MAX_VISIBLE, Math.floor(((stdout?.rows ?? 24) - 13) / 2))) : MAX_VISIBLE;
  const [models, setModels] = useState<ModelInfo[]>(() => visibleModels());
  // Type-to-filter: a registry of 40+ models is un-navigable with arrows
  // alone. Printable keys extend the filter, Backspace retracts, Esc clears
  // it first and closes only when empty.
  const [filter, setFilter] = useState("");
  const [customNote, setCustomNote] = useState<string | null>(null);
  // surface staleness instead of hiding it.
  const [cacheNote, setCacheNote] = useState<string | null>(() =>
    isModelsCacheFresh(DEFAULT_SYNC_TTL_MS) ? null : "Free-model list is stale — prices may be out of date."
  );

  // the coordinator is the single owner — single-flight + TTL mean
  // this can never double-fetch; a failure is reported, never swallowed.
  // Both free routers sync here (OpenRouter + Orcarouter): paid models are
  // dropped at each source, and /models churn (models going free/paid/away)
  // lands in the registry automatically.
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    if (Object.keys(providers).some(id => id.startsWith("custom:"))) {
      void Promise.resolve().then(() => refreshCustomProviderModels(loadCustomProviders().filter(config => providers[config.id]?.isConfigured()), { signal: controller.signal }))
        .then(results => {
          if (!active) return;
          setModels(visibleModels());
          const errors = results.filter(result => result.error).map(result => `${result.providerId}: ${result.error}`);
          setCustomNote(errors.length ? errors.join("; ") : null);
        }).catch(err => { if (active) setCustomNote(getErrorMessage(err)); });
    }
    if (providers.openrouter?.isConfigured() || providers.orcarouter?.isConfigured()) {
      syncFreeModels({
        sources: [createOpenRouterFreeSource(), createOrcarouterFreeSource()],
      }).then((report) => {
        if (!active) return;
        setModels(visibleModels());
        if (report.refreshedAt) setCacheNote(null);
        else if (report.errors.length > 0) {
          setCacheNote("Free-model sync failing — prices may be out of date.");
        }
      });
    }
    return () => {
      active = false;
      controller.abort();
    };
  }, [providers]);

  // Filter after the live-sync state, before grouping/navigation.
  const filteredModels = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const available = minimal && !showAll ? models.filter(model => providers[model.providerId as ProviderId]?.isConfigured(model.id)) : models;
    if (!q) return available;
    return available.filter(
      (m) =>
        m.displayName.toLowerCase().includes(q) || m.id.toLowerCase().includes(q) || m.providerId.toLowerCase().includes(q)
    );
  }, [models, filter, minimal, showAll, providers]);

  const rows: PickerRow[] = useMemo(
    () =>
      filteredModels.map((m) => {
        const provider = providers[m.providerId as ProviderId];
        return {
          model: m,
          enabled: provider?.isConfigured(m.id) ?? false,
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
    const currentIdx = ordered.findIndex((o) => o.row.model.id === currentModelId &&
      (!currentProviderId || o.row.model.providerId === currentProviderId) && o.row.enabled);
    const preserved = ordered.findIndex(entry => `${entry.row.model.providerId}/${entry.row.model.id}` === selection.current);
    if (preserved >= 0) { setSelected(preserved); return; }
    if (currentIdx !== -1) {
      setSelected(currentIdx);
      return;
    }
    const first = ordered.findIndex((o) => o.row.enabled);
    setSelected(first === -1 ? 0 : first);
  }, [ordered, currentModelId, currentProviderId]);

  usePaste(text => { selection.current = null; setFilter(value => value + sanitizeTerminalText(text).replace(/\n/g, " ")); }, { isActive: detail === null });
  useInput((input, key) => {
    if (detail !== null) return;
    if (key.ctrl && input === "n" && onConnect) { onConnect(); return; }
    if (key.ctrl && input === "o" && ordered[selected]) {
      const row = ordered[selected].row;
      setDetail(`${row.providerDisplayName}\n${JSON.stringify(row.model, null, 2)}\n${row.enabled ? "Ready to select; inference has not been tested by this action." : row.provider?.configurationIssue?.(row.model.id) ?? "Provider not connected."}`); return;
    }
    if (key.ctrl || key.meta) return;
    if (key.tab && minimal) { selection.current = null; setShowAll(value => !value); return; }
    if (key.escape) {
      if (filter) setFilter(""); // filter first, close second
      else onClose();
      return;
    }
    if (key.backspace) {
      setFilter((f) => f.slice(0, -1));
      return;
    }
    if (!key.upArrow && !key.downArrow && !key.return && !key.tab && input && !key.ctrl && !key.meta) {
      // Paste arrives as one multi-character chunk; a length===1 guard
      // dropped it wholesale, so a pasted model id never reached the filter.
      const printable = sanitizeTerminalText(input);
      if (printable) setFilter((f) => f + printable);
      return;
    }
    if (ordered.length === 0) {
      // Empty filter match: nothing to move to or confirm (the old modulo
      // by zero produced selected=NaN and a "NaN/0" header).
      return;
    }
    if (key.upArrow || key.downArrow) {
      const dir = key.upArrow ? -1 : 1;
      let next = selected;
      // Skip over disabled (unconfigured) entries rather than selecting them
      for (let i = 0; i < ordered.length; i++) {
        next = (next + dir + ordered.length) % ordered.length;
        if (minimal || ordered[next].row.enabled) break;
      }
      setSelected(next);
      selection.current = `${ordered[next].row.model.providerId}/${ordered[next].row.model.id}`;
    } else if (key.return) {
      const entry = ordered[selected];
      if (entry?.row.enabled) onSelect(entry.row.provider, entry.row.model);
      else if (entry && minimal) setCustomNote(entry.row.provider?.configurationIssue?.(entry.row.model.id) ?? "Use /connect to configure this provider.");
    }
  });

  const { offset: scrollOffset, hasAbove, hasBelow } = useWindowedList(ordered.length, selected, maxVisible);

  const visible = useMemo(() => {
    return ordered
      .slice(scrollOffset, scrollOffset + maxVisible)
      .map((entry, i) => ({ ...entry, pos: scrollOffset + i }));
  }, [ordered, scrollOffset, maxVisible]);

  // DW-2.5 context window badge: 128000 → "128K", 2000000 → "2M".
  const formatWindow = (tokens: number | undefined): string => {
    if (tokens === undefined || tokens <= 0) return "";
    if (tokens >= 1_000_000) return `${Math.round(tokens / 1_000_000)}M`;
    if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}K`;
    return `${tokens}`;
  };

  const renderRow = (entry: (typeof visible)[number]) => {
    const { row, pos } = entry;
    const isSelected = pos === selected;
    const isCurrent = row.model.id === currentModelId && (!currentProviderId || row.model.providerId === currentProviderId);
    const marker = isSelected ? "❯ " : "  ";
    if (minimal) return <Text key={`${row.model.providerId}/${row.model.id}`} color={isSelected ? theme.colors.textPrimary : theme.colors.textSecondary} wrap="truncate-end">{marker}{sanitizeTerminalText(row.model.displayName).replace(/\n/g, " ")}{isCurrent ? " · current" : ""}{!row.enabled ? " · unavailable" : ""}</Text>;
    const windowTag = formatWindow(row.model.contextWindow);
    const windowSuffix = windowTag ? ` ${windowTag}` : "";
    const kind = pricingKind(row.model.isFree);
    // The live sync names include "(Free)" — the [FREE] tag would duplicate it.
    const nameAlreadySaysFree = /\(free\)/i.test(row.model.displayName);
    const pricingTag = nameAlreadySaysFree ? "" : formatPricingTag(row.model.isFree);
    const limited = isRateLimited(row.model.providerId, row.model.id);

    const certBadge = row.model.certified;
    const certLabel = formatCertificationBadge(certBadge, row.model.certifiedMode);

    if (!row.enabled) {
      return (
        <Text key={row.model.id} color={theme.colors.textSecondary}>
          {marker}
          {row.model.displayName}
          {windowSuffix}
          {pricingTag}
          {certLabel}
          {limited ? " [rate-limited]" : ""} (no API key)
        </Text>
      );
    }
    return (
      <Text key={row.model.id} color={isSelected ? theme.colors.primary : theme.colors.userText}>
        {marker}
        {row.model.displayName}
        {windowSuffix && <Text color={theme.colors.textSecondary}>{windowSuffix}</Text>}
        {kind === "free" ? (
          <Text color={theme.colors.toolDone} bold> [FREE]</Text>
        ) : kind === "paid" ? (
          <Text color={theme.colors.textSecondary}> [PAID]</Text>
        ) : null}
        {certBadge === "live" ? (
          // A mock pass is real but weaker — dim it, don't dress it as a probe.
          <Text color={row.model.certifiedMode === "live" ? theme.colors.toolDone : theme.colors.textSecondary}>
            {certLabel}
          </Text>
        ) : certBadge === "broken" ? (
          <Text color={theme.colors.toolError}>{certLabel}</Text>
        ) : certBadge === "untested" ? (
          <Text color={theme.colors.textSecondary}>{certLabel}</Text>
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

  // Counter over ENABLED rows only: navigation skips disabled entries, so a
  // raw index would point at unselectable rows.
  const enabledTotal = ordered.reduce((n, o) => n + (o.row.enabled ? 1 : 0), 0);
  const enabledPos = ordered
    .slice(0, selected + 1)
    .reduce((n, o) => n + (o.row.enabled ? 1 : 0), 0);
  if (detail !== null) return <TextDetail title="Model details" text={detail} onClose={() => setDetail(null)} />;
  return (
    <OverlayFrame
      minimal={minimal}
      title="Select a model"
      meta={minimal ? ordered.length > 0 ? `(${Math.min(selected + 1, ordered.length)}/${ordered.length})` : "(no matches)" : enabledTotal > 0 ? `(${enabledPos}/${enabledTotal})` : "(no matches)"}
      hints={minimal ? "↑/↓ select · Enter switch · Tab all/connected · Esc back" : "↑/↓ · Enter switch · Esc cancel · type to filter"}
    >
      {ordered.length === 0 && (
        <Text color={theme.colors.textSecondary}>
          Nothing matches the filter — Backspace to erase, Esc to cancel.
        </Text>
      )}
      {filter && (
        <Text color={theme.colors.textSecondary}>
          filter: <Text color={theme.colors.toolName}>{filter}</Text> — Backspace to erase, Esc to clear
        </Text>
      )}
      {!minimal && cacheNote && <Text color={theme.colors.textSecondary}>⚠ {cacheNote}</Text>}
      {customNote && <Text color={theme.colors.warning} wrap="truncate-end">⚠ {customNote}</Text>}
      {hasAbove && (
        <Text color={theme.colors.textSecondary}>  ▲ {scrollOffset} more above...</Text>
      )}
      {grouped.map((section) => (
        <Box key={section.key} flexDirection="column">
          <Text color={theme.colors.textSecondary}>
            {sectionRule(theme.typography.sectionDivider, 2)} {section.header}{" "}
            {sectionRule(theme.typography.sectionDivider, 2)}
          </Text>
          {section.rows.map(renderRow)}
        </Box>
      ))}
      {minimal && <>
        <Text color={theme.colors.textSecondary}>{showAll ? "All models" : "Connected models"}</Text>
        <Text color={theme.colors.textSecondary}>Ctrl+O details{onConnect ? " · Ctrl+N connect" : " · /connect adds a provider"}</Text>
        {ordered[selected] && <>
          <Text color={theme.colors.textSecondary} wrap="truncate-end">{ordered[selected].row.model.id} · {formatWindow(ordered[selected].row.model.contextWindow)} · {formatPricingTag(ordered[selected].row.model.isFree)}{formatCertificationBadge(ordered[selected].row.model.certified, ordered[selected].row.model.certifiedMode)}</Text>
          {!ordered[selected].row.enabled && <Text color={theme.colors.warning} wrap="truncate-end">{ordered[selected].row.provider?.configurationIssue?.(ordered[selected].row.model.id) ?? "Provider not connected. Use /connect to configure it."}</Text>}
        </>}
      </>}
      {hasBelow && (
        <Text color={theme.colors.textSecondary}>  ▼ {ordered.length - (scrollOffset + maxVisible)} more below...</Text>
      )}
    </OverlayFrame>
  );
}
