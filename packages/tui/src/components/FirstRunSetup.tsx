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
  title = "Welcome to Anvil. Configure at least one provider's API key to start.",
}: {
  onDone: (providerId: ProviderId) => void;
  title?: string;
}) {
  const theme = useTheme();
  const [selected, setSelected] = useState(0);
  const [apiKey, setApiKey] = useState("");
  const [step, setStep] = useState<"provider" | "key" | "done">("provider");
  const provider = PROVIDERS[selected];

  useInput((_input, key) => {
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
      <Box flexDirection="column" paddingX={1}>
        <Text color={theme.colors.primary}>{title}</Text>
        <Text dimColor>Step 1 of 2 — choose a provider, Enter to continue:</Text>
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
      <Box flexDirection="column" paddingX={1}>
        <Text dimColor>Step 2 of 2 — paste the key (↑/↓ won't work here)</Text>
        <Text color={theme.colors.primary}>
          Paste your {provider.marketLabel} API key (input is hidden):
        </Text>
        <TextInput
          value={apiKey}
          onChange={setApiKey}
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
    <Box flexDirection="column" paddingX={1}>
      <Text color={theme.colors.toolDone}>✓ {provider.marketLabel} API key saved.</Text>
      <Text dimColor>Add more providers or press Enter to continue.</Text>
    </Box>
  );
}