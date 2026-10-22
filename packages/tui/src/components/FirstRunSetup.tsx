import { useState } from "react";
import { Box, Text, useApp, useStdout } from "ink";
import { useInput } from "../hooks/useUIInput.js";
import TextInput from "ink-text-input";
import type { ProviderId } from "@imitravanu/anvil-core";
import { getErrorMessage, saveCredential, loadCustomProviders, type CustomProviderConfig } from "@imitravanu/anvil-core";
import { useTheme } from "../theme/theme.js";
import { PROVIDER_META } from "../util/providers.js";
import { OverlayFrame } from "./OverlayFrame.js";
import { CustomProviderSetup } from "./CustomProviderSetup.js";
import { useWindowedList } from "../hooks/useWindowedList.js";
import { MAX_VISIBLE_ROWS } from "../util/displayLimits.js";

const PROVIDERS = PROVIDER_META;

/**
 * Provider connect/onboarding flow: pick a provider, paste an API key
 * (masked), save it. Used for first-run onboarding, `anvil config`, and the
 * in-app `/connect` command (where it renders as an overlay).
 */
export function FirstRunSetup({
  onDone,
  onCancel,
  onRemoved,
  activeProviderId,
  title = "Welcome to Anvil. Configure at least one provider's API key to start.",
  handleCtrlC = true,
}: {
  onDone: (providerId: ProviderId) => void;
  /** Esc-to-cancel for the /connect overlay. First-run boot omits it: Anvil
   *  needs one provider before it can start, so Esc would be a dead end. */
  onCancel?: () => void;
  onRemoved?: () => void;
  activeProviderId?: ProviderId;
  title?: string;
  handleCtrlC?: boolean;
}) {
  const { exit } = useApp();
  const theme = useTheme();
  const { stdout } = useStdout();
  const visibleRows = Math.max(1, Math.min(MAX_VISIBLE_ROWS, Math.floor(((stdout?.rows ?? 24) - 10) / 2)));
  const [selected, setSelected] = useState(0);
  const [apiKey, setApiKey] = useState("");
  const [step, setStep] = useState<"provider" | "key" | "done">("provider");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [customs, setCustoms] = useState(loadCustomProviders);
  const [customSetup, setCustomSetup] = useState<{ initial?: CustomProviderConfig } | null>(null);
  const rows = [...PROVIDERS.map(provider => ({ id: provider.id, label: provider.shortLabel })),
    ...customs.map(provider => ({ id: provider.id, label: `${provider.name} (custom)` })),
    { id: "add-custom", label: "+ Custom endpoint (Chat, Responses, Anthropic)" }];
  const window = useWindowedList(rows.length, selected, visibleRows);
  const provider = PROVIDERS[selected];

  useInput((input, key) => {
    if (handleCtrlC && key.ctrl && (input === "c" || input === "\x03")) { exit(); return; }
    if (customSetup) return;
    if (key.escape) {
      // F11 (AUDIT-2026-09-30): every overlay honors Esc at EVERY step. /connect
      // passes onCancel; first-run omits it (a provider is required to start),
      // and the absence of the callback is what keeps Esc inert there.
      onCancel?.();
      return;
    }
    if (step === "provider") {
      if (key.upArrow) setSelected((s) => Math.max(0, s - 1));
      else if (key.downArrow) setSelected((s) => Math.min(rows.length - 1, s + 1));
      else if (key.return) {
        if (selected >= PROVIDERS.length) setCustomSetup({ initial: customs[selected - PROVIDERS.length] });
        else setStep("key");
      }
    } else if (step === "done" && key.return) {
      onDone(provider.id);
    }
  });

  // Phase 41 — onboarding is framed like every other overlay instead of bare
  // text: theme modal border, brand title, step in the meta slot.
  const brandTitle = `${theme.typography.brandIcon} ${theme.typography.brandName}`;

  if (customSetup) return <CustomProviderSetup simple initial={customSetup.initial} activeProviderId={activeProviderId}
    onDone={onDone} onCancel={() => setCustomSetup(null)} onRemoved={() => {
      setCustoms(loadCustomProviders()); setSelected(0); setCustomSetup(null); onRemoved?.();
    }} />;

  if (step === "provider") {
    return (
      <OverlayFrame
        title={brandTitle}
        meta="connect a provider"
        hints={onCancel ? "Esc cancel" : undefined}
      >
        <Text color={theme.colors.primary}>{title}</Text>
        <Text color={theme.colors.textSecondary}>Step 1 of 2 — choose a provider, Enter to continue{onCancel ? ", Esc to cancel" : ""}:</Text>
        {window.hasAbove && <Text color={theme.colors.textSecondary}>↑ more providers</Text>}
        {rows.slice(window.offset, window.offset + visibleRows).map((p, index) => (
          // The absolute index keeps selection aligned while the list scrolls.
          <Text key={p.id} color={index + window.offset === selected ? theme.colors.primary : theme.colors.textSecondary}>
            {index + window.offset === selected ? "❯ " : "  "}
            {p.label}
          </Text>
        ))}
        {window.hasBelow && <Text color={theme.colors.textSecondary}>↓ more providers</Text>}
      </OverlayFrame>
    );
  }

  if (step === "key") {
    return (
      <OverlayFrame title={brandTitle} meta="Step 2 of 2" hints={onCancel ? "Esc cancel" : undefined}>
        <Text color={theme.colors.textSecondary}>Paste the key — ↑/↓ won't work here</Text>
        <Text color={theme.colors.primary}>
          Paste your {provider.marketLabel} API key (input is hidden):
        </Text>
        {saveError && (
          <Text color={theme.colors.error}>
            Could not save the key ({saveError}) — check that {`~/.anvil`} is writable, then press Enter again.
          </Text>
        )}
        <TextInput
          value={apiKey}
          onChange={(next) => {
            // Same batched-keystroke hazard as InputBar: a return embedded in
            // the frame. A newline is not a valid API-key character; preserve
            // the buffer for editing rather than silently trimming corrupt input.
            const idx = next.search(/[\r\n]/);
            if (idx !== -1) {
              setApiKey(next.slice(0, idx));
              return;
            }
            setApiKey(next);
          }}
          mask={provider.id === "ollama" ? undefined : "*"}
          placeholder={provider.placeholder ?? "sk-..."}
          onSubmit={(value) => {
            const trimmed = value.trim() || (provider.id === "ollama" ? "ollama" : "");
            if (!trimmed) return;
            // `saveCredential` writes to ~/.anvil and throws on a full disk or
            // unwritable home. This runs inside an Ink input handler, where a
            // throw escapes as an uncaught exception and kills the process
            // mid-onboarding — so it is caught here and retried in place
            // (`saveSession` is wrapped the same way for the same reason).
            try {
              saveCredential(provider.field, trimmed);
            } catch (err: unknown) {
              setSaveError(getErrorMessage(err));
              return;
            }
            setSaveError(null);
            setStep("done");
          }}
        />
      </OverlayFrame>
    );
  }

  // done — wait for Enter, then hand off to the caller
  return (
    <OverlayFrame title={brandTitle} meta="ready" hints="Enter continue">
      <Text color={theme.colors.toolDone}>✓ {provider.marketLabel} API key saved.</Text>
      <Text color={theme.colors.textSecondary}>Key saved; model connectivity has not been tested. Enter to continue.</Text>
    </OverlayFrame>
  );
}
