import { useState } from "react";
import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";
import type { ProviderCredentials, ProviderId } from "@anvil/core";
import { saveCredential } from "@anvil/core";
import { useTheme } from "../theme/theme.js";

const PROVIDERS: { id: ProviderId; label: string; field: keyof ProviderCredentials }[] = [
  { id: "anthropic", label: "Anthropic", field: "anthropicApiKey" },
  { id: "openai", label: "OpenAI", field: "openaiApiKey" },
  { id: "gemini", label: "Google Gemini", field: "geminiApiKey" },
  { id: "openrouter", label: "OpenRouter", field: "openrouterApiKey" },
];

/**
 * First-run onboarding: pick a provider, paste an API key (masked), save it.
 * Used both for the very first run (no credentials at all) and `anvil config`.
 */
export function FirstRunSetup({ onDone }: { onDone: (providerId: ProviderId) => void }) {
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
        <Text color={theme.colors.primary}>
          Welcome to Anvil. Configure at least one provider's API key to start.
        </Text>
        <Text dimColor>↑/↓ to choose a provider, Enter to continue:</Text>
        {PROVIDERS.map((p, i) => (
          <Text key={p.id} color={i === selected ? theme.colors.primary : undefined}>
            {i === selected ? "❯ " : "  "}
            {p.label}
          </Text>
        ))}
      </Box>
    );
  }

  if (step === "key") {
    return (
      <Box flexDirection="column" paddingX={1}>
        <Text color={theme.colors.primary}>
          Paste your {provider.label} API key (input is hidden):
        </Text>
        <TextInput
          value={apiKey}
          onChange={setApiKey}
          mask="*"
          placeholder="sk-..."
          onSubmit={(value) => {
            const trimmed = value.trim();
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
      <Text color={theme.colors.toolDone}>✓ {provider.label} API key saved.</Text>
      <Text dimColor>Press Enter to continue.</Text>
    </Box>
  );
}