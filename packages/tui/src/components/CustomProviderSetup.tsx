import { useState } from "react";
import { Text } from "ink";
import { useInput, usePaste } from "../hooks/useUIInput.js";
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
  protocol: "openai-chat" | "openai-responses" | "anthropic";
}

const FIELDS: Array<{ key: keyof SetupValues; label: string }> = [
  { key: "id", label: "Provider ID (lowercase letters, numbers and hyphens)" },
  { key: "name", label: "Display name" },
  { key: "baseUrl", label: "API base URL (include /v1 if required)" },
  { key: "credential", label: "API key or $ENV_NAME; '-' for no authentication; blank keeps an existing key" },
  { key: "models", label: "Model IDs (comma-separated; blank discovers automatically)" },
  { key: "contextWindow", label: "Context window in tokens (conservative default; set your model's limit)" },
  { key: "options", label: "Optional JSON: protocol, headers, maxTokensParam, streamUsage, supportsTools, supportsVision" },
];

export function CustomProviderSetup({ initial, activeProviderId, onDone, onRemoved, onCancel, simple = false }: {
  simple?: boolean;
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
    models: initial?.models?.map(model => model.id).join(", ") ?? "",
    contextWindow: String(initial?.models?.[0]?.contextWindow ?? FALLBACK_CONTEXT_WINDOW),
    protocol: initial?.protocol ?? "openai-chat",
    options: JSON.stringify({
      headers: initial?.headers ?? {}, maxTokensParam: initial?.maxTokensParam ?? "max_tokens",
      streamUsage: initial?.streamUsage ?? true,
      protocol: initial?.protocol ?? "openai-chat",
    }),
  }));
  const [advanced, setAdvanced] = useState(false);
  const fields = simple ? advanced ? FIELDS.filter(field => ["contextWindow", "options"].includes(field.key)) : [
    FIELDS[1], FIELDS[2], { key: "protocol" as const, label: "Wire protocol — ↑/↓ choose, Enter continue" }, FIELDS[3], FIELDS[4],
  ] : FIELDS;
  const [step, setStep] = useState(simple ? 0 : initial ? 1 : 0);
  const [error, setError] = useState<string | null>(null);
  const [review, setReview] = useState<{ config: CustomProviderConfig; apiKey?: string } | null>(null);
  const [removing, setRemoving] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const field = fields[step];

  const prepare = (next: SetupValues) => {
    const options: unknown = JSON.parse(next.options || "{}");
    if (typeof options !== "object" || options === null || Array.isArray(options)) throw new Error("Options must be a JSON object.");
    const extras = options as Record<string, unknown>;
    if (Object.keys(extras).some(key => !["protocol", "headers", "maxTokensParam", "streamUsage", "supportsTools", "supportsVision"].includes(key))) throw new Error("Unknown option. Use the fields listed above.");
    const { supportsTools, supportsVision, ...providerOptions } = extras;
    const credential = next.credential.trim();
    const auth = credential === "-" ? "none" : credential ? "bearer" : initial?.auth;
    const apiKeyEnv = credential.startsWith("$") ? credential.slice(1)
      : !credential ? initial?.apiKeyEnv : undefined;
    const config = validateCustomProvider({
      id: initial?.id ?? `custom:${simple ? next.name.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") : next.id.trim()}`, name: next.name, baseUrl: next.baseUrl,
      auth, ...(apiKeyEnv ? { apiKeyEnv } : {}), ...providerOptions,
      ...(simple && !advanced ? { protocol: next.protocol } : {}),
      models: next.models ? next.models.split(",").map(id => {
        const old = initial?.models?.find(model => model.id === id.trim());
        return {
          ...old, id: id.trim(), contextWindow: old && next.contextWindow === String(initial?.models?.[0]?.contextWindow)
            ? old.contextWindow : Number(next.contextWindow),
          ...(supportsTools !== undefined ? { supportsTools } : {}),
          ...(supportsVision !== undefined ? { supportsVision } : {}),
        };
      }) : [],
    });
    if (!initial && loadCustomProviders().some(old => old.id === config.id)) throw new Error("This provider ID already exists. Select it from /connect to edit it.");
    return { config, ...(credential && credential !== "-" && !credential.startsWith("$") ? { apiKey: credential } : {}) };
  };

  usePaste(text => {
    if (!review && field?.key !== "protocol") setValues(previous => ({ ...previous, [field.key]: previous[field.key] + text.replace(/[\r\n]/g, "") }));
  }, { isActive: !review && !removing && field?.key !== "protocol" });
  useInput((input, key) => {
    if (key.escape) {
      setError(null);
      if (removing) { setRemoving(false); return; }
      if (review) { setReview(null); setStep(fields.length - 1); }
      else if (step > (simple ? 0 : initial ? 1 : 0)) { setStep(step - 1); setReview(null); }
      else if (advanced) { setAdvanced(false); setStep(0); }
      else onCancel();
      return;
    }
    if (!review && field?.key === "protocol") {
      const protocols = ["openai-chat", "openai-responses", "anthropic"] as const;
      if (key.upArrow || key.downArrow) setValues(previous => ({ ...previous, protocol: protocols[(protocols.indexOf(previous.protocol) + (key.upArrow ? 2 : 1)) % protocols.length] }));
      else if (key.return) setStep(value => value + 1);
      return;
    }
    if (!review || removing) return;
    if (input === "a" && simple && !advanced) {
      setValues(previous => ({ ...previous, options: JSON.stringify({ ...JSON.parse(previous.options || "{}"), protocol: previous.protocol }) }));
      setReview(null); setAdvanced(true); setStep(0); return;
    }
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
    <OverlayFrame minimal={simple} title={initial ? "Edit custom provider" : "Add custom provider"}
      meta={removing ? "confirm removal" : review ? "review" : `${step + 1} / ${fields.length}`}
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
        <Text color={theme.colors.textSecondary}>Protocol: {review.config.protocol ?? "openai-chat"}</Text>
        <Text color={theme.colors.textSecondary}>Models: {review.config.models?.length ? review.config.models.map(model => model.id).join(", ") : "dynamic / auto-discover"}</Text>
        <Text color={theme.colors.textSecondary}>Authentication: {review.config.auth === "none" ? "none" : review.config.apiKeyEnv ? `environment (${review.config.apiKeyEnv})` : "stored key (hidden)"}</Text>
        <Text color={theme.colors.textSecondary}>Settings and keys are saved separately with owner-only permissions.</Text>
        {simple && !advanced && <Text color={theme.colors.textSecondary}>a — advanced settings (context, headers and compatibility)</Text>}
        {initial && initial.id !== activeProviderId && <Text color={theme.colors.warning}>d — remove this provider</Text>}
        {initial?.id === activeProviderId && <Text color={theme.colors.textSecondary}>Switch to another provider before removing this one.</Text>}
      </> : <>
        <Text color={theme.colors.primary}>{field.label}</Text>
        {field.key === "protocol" ? <Text color={theme.colors.textPrimary}>{values.protocol}</Text> : <TextInput key={field.key} value={values[field.key]}
          mask={field.key === "credential" ? "*" : undefined}
          onChange={value => setValues({ ...values, [field.key]: value.replace(/[\r\n]/g, "") })}
          onSubmit={value => {
            const next = { ...values, [field.key]: value.trim() };
            setValues(next);
            setError(null);
            if (!value.trim() && !["credential", "options", "models"].includes(field.key)) {
              setError("This field is required."); return;
            }
            if (step === fields.length - 1) {
              try { setReview(prepare(next)); }
              catch (err) { setError(err instanceof SyntaxError ? "Options must contain valid JSON." : getErrorMessage(err)); return; }
            }
            setStep(step + 1);
          }} />}
      </>}
    </OverlayFrame>
  );
}
