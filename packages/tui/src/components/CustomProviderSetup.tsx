import { useState } from "react";
import { Text, useInput } from "ink";
import TextInput from "ink-text-input";
import {
  FALLBACK_CONTEXT_WINDOW, getErrorMessage, removeCustomProvider, saveCustomProvider,
  validateCustomProvider, loadCustomProviders, type CustomProviderConfig, type ProviderId,
} from "@anvil/core";
import { useTheme } from "../theme/theme.js";
import { OverlayFrame } from "./OverlayFrame.js";

interface SetupValues {
  id: string; name: string; baseUrl: string; credential: string;
  models: string; contextWindow: string; options: string;
}

const FIELDS: Array<{ key: keyof SetupValues; label: string }> = [
  { key: "id", label: "Provider ID (lowercase letters, numbers and hyphens)" },
  { key: "name", label: "Display name" },
  { key: "baseUrl", label: "OpenAI-compatible API base URL (include /v1 if required)" },
  { key: "credential", label: "API key or $ENV_NAME; '-' for no authentication; blank keeps an existing key" },
  { key: "models", label: "Model IDs (comma-separated; first is the default)" },
  { key: "contextWindow", label: "Context window in tokens (conservative default; set your model's limit)" },
  { key: "options", label: "Optional JSON: headers, maxTokensParam, streamUsage, supportsTools, supportsVision" },
];

export function CustomProviderSetup({ initial, activeProviderId, onDone, onRemoved, onCancel }: {
  initial?: CustomProviderConfig;
  activeProviderId?: ProviderId;
  onDone: (id: ProviderId) => void;
  onRemoved: () => void;
  onCancel: () => void;
}) {
  const theme = useTheme();
  const [values, setValues] = useState<SetupValues>(() => ({
    id: initial?.id.slice("custom:".length) ?? "",
    name: initial?.name ?? "", baseUrl: initial?.baseUrl ?? "", credential: "",
    models: initial?.models.map(model => model.id).join(", ") ?? "",
    contextWindow: String(initial?.models[0].contextWindow ?? FALLBACK_CONTEXT_WINDOW),
    options: JSON.stringify({
      headers: initial?.headers ?? {}, maxTokensParam: initial?.maxTokensParam ?? "max_tokens",
      streamUsage: initial?.streamUsage ?? true,
    }),
  }));
  const [step, setStep] = useState(initial ? 1 : 0);
  const [error, setError] = useState<string | null>(null);
  const [review, setReview] = useState<{ config: CustomProviderConfig; apiKey?: string } | null>(null);
  const [removing, setRemoving] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const field = FIELDS[step];

  const prepare = (next: SetupValues) => {
    const options: unknown = JSON.parse(next.options || "{}");
    if (typeof options !== "object" || options === null || Array.isArray(options)) throw new Error("Options must be a JSON object.");
    const extras = options as Record<string, unknown>;
    if (Object.keys(extras).some(key => !["headers", "maxTokensParam", "streamUsage", "supportsTools", "supportsVision"].includes(key))) throw new Error("Unknown option. Use the fields listed above.");
    const { supportsTools, supportsVision, ...providerOptions } = extras;
    const credential = next.credential.trim();
    const auth = credential === "-" ? "none" : credential ? "bearer" : initial?.auth;
    const apiKeyEnv = credential.startsWith("$") ? credential.slice(1)
      : !credential ? initial?.apiKeyEnv : undefined;
    const config = validateCustomProvider({
      id: initial?.id ?? `custom:${next.id.trim()}`, name: next.name, baseUrl: next.baseUrl,
      auth, ...(apiKeyEnv ? { apiKeyEnv } : {}), ...providerOptions,
      models: next.models.split(",").map(id => {
        const old = initial?.models.find(model => model.id === id.trim());
        return {
          ...old, id: id.trim(), contextWindow: old && next.contextWindow === String(initial?.models[0].contextWindow)
            ? old.contextWindow : Number(next.contextWindow),
          ...(supportsTools !== undefined ? { supportsTools } : {}),
          ...(supportsVision !== undefined ? { supportsVision } : {}),
        };
      }),
    });
    if (!initial && loadCustomProviders().some(old => old.id === config.id)) throw new Error("This provider ID already exists. Select it from /connect to edit it.");
    return { config, ...(credential && credential !== "-" && !credential.startsWith("$") ? { apiKey: credential } : {}) };
  };

  useInput((input, key) => {
    if (key.escape) {
      setError(null);
      if (removing) { setRemoving(false); return; }
      if (step > (initial ? 1 : 0)) { setStep(step - 1); setReview(null); }
      else onCancel();
      return;
    }
    if (!review || removing) return;
    if (input === "d" && initial && initial.id !== activeProviderId) {
      setRemoving(true); return;
    }
    if (key.return) {
      try { saveCustomProvider(review.config, review.apiKey); }
      catch (err) { setError(getErrorMessage(err)); return; }
      onDone(review.config.id);
    }
  });

  return (
    <OverlayFrame title={initial ? "Edit custom provider" : "Add custom provider"}
      meta={removing ? "confirm removal" : review ? "review" : `${step + 1} / ${FIELDS.length}`}
      hints={review ? "Enter save · Esc back" : "Enter next · Esc back"}>
      {error && <Text color={theme.colors.error}>{error}</Text>}
      {removing ? <>
        <Text color={theme.colors.warning}>Remove {initial?.name}? Type its provider ID to confirm: {initial?.id}</Text>
        <TextInput value={confirmation} onChange={setConfirmation} onSubmit={value => {
          if (value !== initial?.id) { setError("The provider ID did not match."); return; }
          try { removeCustomProvider(initial.id); }
          catch (err) { setError(getErrorMessage(err)); return; }
          onRemoved();
        }} />
      </> : review ? <>
        <Text color={theme.colors.primary}>{review.config.name} · {review.config.id}</Text>
        <Text color={theme.colors.textSecondary}>{review.config.baseUrl}</Text>
        <Text color={theme.colors.textSecondary}>Models: {review.config.models.map(model => model.id).join(", ")}</Text>
        <Text color={theme.colors.textSecondary}>Authentication: {review.config.auth === "none" ? "none" : review.config.apiKeyEnv ? `environment (${review.config.apiKeyEnv})` : "stored key (hidden)"}</Text>
        <Text color={theme.colors.textSecondary}>Settings and keys are saved separately with owner-only permissions.</Text>
        {initial && initial.id !== activeProviderId && <Text color={theme.colors.warning}>d — remove this provider</Text>}
        {initial?.id === activeProviderId && <Text color={theme.colors.textSecondary}>Switch to another provider before removing this one.</Text>}
      </> : <>
        <Text color={theme.colors.primary}>{field.label}</Text>
        <TextInput key={field.key} value={values[field.key]}
          mask={field.key === "credential" ? "*" : undefined}
          onChange={value => setValues({ ...values, [field.key]: value.replace(/[\r\n]/g, "") })}
          onSubmit={value => {
            const next = { ...values, [field.key]: value.trim() };
            setValues(next);
            setError(null);
            if (!value.trim() && field.key !== "credential" && field.key !== "options") {
              setError("This field is required."); return;
            }
            if (step === FIELDS.length - 1) {
              try { setReview(prepare(next)); }
              catch (err) { setError(err instanceof SyntaxError ? "Options must contain valid JSON." : getErrorMessage(err)); return; }
            }
            setStep(step + 1);
          }} />
      </>}
    </OverlayFrame>
  );
}
