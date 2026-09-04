import { useState } from "react";
import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";
import type { ProviderCredentials, ProviderId } from "@anvil/core";
import { saveCredential } from "@anvil/core";
import { useTheme } from "../theme/theme.js";

const PROVIDERS: { id: ProviderId; label: string; field: keyof ProviderCredentials; placeholder?: string }[] = [
  { id: "anthropic", label: "Anthropic", field: "anthropicApiKey" },
  { id: "openai", label: "OpenAI", field: "openaiApiKey" },
  { id: "gemini", label: "Google Gemini (Free Tier)", field: "geminiApiKey" },
  { id: "openrouter", label: "OpenRouter (Free Models)", field: "openrouterApiKey" },
  { id: "groq", label: "Groq (100% Free & Blazing Fast)", field: "groqApiKey", placeholder: "gsk_..." },
  { id: "github", label: "GitHub Models (Free GPT-4o-mini with PAT)", field: "githubApiKey", placeholder: "ghp_..." },
  { id: "cerebras", label: "Cerebras (1M Free Tokens/day)", field: "cerebrasApiKey", placeholder: "csk_..." },
  { id: "mistral", label: "Mistral AI / Codestral (Free Tier)", field: "mistralApiKey" },
  { id: "ollama", label: "Ollama (Local $0 Offline - localhost:11434)", field: "ollamaApiKey", placeholder: "Enter to connect" },
];

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
            {p.label}
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
          Paste your {provider.label} API key (input is hidden):
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
      <Text color={theme.colors.toolDone}>✓ {provider.label} API key saved.</Text>
      <Text dimColor>Add more providers or press Enter to continue.</Text>
    </Box>
  );
}