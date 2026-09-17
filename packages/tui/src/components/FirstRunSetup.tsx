import { useState } from "react";
import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";
import type { ProviderId } from "@anvil/core";
import { saveCredential } from "@anvil/core";
import { useTheme } from "../theme/theme.js";
import { PROVIDER_META } from "../util/providers.js";

const PROVIDERS = PROVIDER_META;

/**
 * Provider connect/onboarding flow: pick a provider, paste an API key
 * (masked), save it. Used for first-run onboarding, `anvil config`, and the
 * in-app `/connect` command (where it renders as an overlay).
 */
export function FirstRunSetup({
  onDone,
  onCancel,
  title = "Welcome to Anvil. Configure at least one provider's API key to start.",
}: {
  onDone: (providerId: ProviderId) => void;
  /** Esc-to-cancel for the /connect overlay. First-run boot omits it: Anvil
   *  needs one provider before it can start, so Esc would be a dead end. */
  onCancel?: () => void;
  title?: string;
}) {
  const theme = useTheme();
  const [selected, setSelected] = useState(0);
  const [apiKey, setApiKey] = useState("");
  const [step, setStep] = useState<"provider" | "key" | "done">("provider");
  const provider = PROVIDERS[selected];

  useInput((_input, key) => {
    if (key.escape) {
      // Every overlay honors Esc; /connect passes onCancel, first-run does not
      // (a provider is required before the app can start).
      if (onCancel && step === "provider") onCancel();
      return;
    }
    if (step === "provider") {
      if (key.upArrow) setSelected((s) => Math.max(0, s - 1));
      else if (key.downArrow) setSelected((s) => Math.min(PROVIDERS.length - 1, s + 1));
      else if (key.return) setStep("key");
    } else if (step === "done" && key.return) {
      onDone(provider.id);
    }
  });

  if (step === "provider") {
    return (
      <Box flexDirection="column" flexShrink={0} paddingX={1}>
        <Text color={theme.colors.primary}>{title}</Text>
        <Text dimColor>Step 1 of 2 — choose a provider, Enter to continue{onCancel ? ", Esc to cancel" : ""}:</Text>
        {PROVIDERS.map((p, i) => (
          <Text key={p.id} color={i === selected ? theme.colors.primary : undefined}>
            {i === selected ? "❯ " : "  "}
            {p.marketLabel}
          </Text>
        ))}
      </Box>
    );
  }

  if (step === "key") {
    return (
      <Box flexDirection="column" flexShrink={0} paddingX={1}>
        <Text dimColor>Step 2 of 2 — paste the key (↑/↓ won't work here)</Text>
        <Text color={theme.colors.primary}>
          Paste your {provider.marketLabel} API key (input is hidden):
        </Text>
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
            saveCredential(provider.field, trimmed);
            setStep("done");
          }}
        />
      </Box>
    );
  }

  // done — wait for Enter, then hand off to the caller
  return (
    <Box flexDirection="column" flexShrink={0} paddingX={1}>
      <Text color={theme.colors.toolDone}>✓ {provider.marketLabel} API key saved.</Text>
      <Text dimColor>Add more providers or press Enter to continue.</Text>
    </Box>
  );
}
