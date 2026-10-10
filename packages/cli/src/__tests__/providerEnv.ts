/**
 * "No credentials" tests simulate first-run with an empty ANVIL_HOME — but
 * `resolveProviderCredentials` (2026-10-10) also reads the documented provider
 * env vars, so an ambient key on a dev machine (an OPENROUTER_API_KEY on the
 * chief-engineer's own shell) made the install look configured and rerouted
 * the boot under test. Scrub the documented names for the test's duration;
 * the returned function restores exactly what was there.
 */
const PROVIDER_ENV_VARS = [
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
  "OPENROUTER_API_KEY",
  "ORCAROUTER_API_KEY",
  "GROQ_API_KEY",
  "CEREBRAS_API_KEY",
  "GITHUB_TOKEN",
  "GITHUB_API_KEY",
  "MISTRAL_API_KEY",
  "INCEPTION_API_KEY",
  "OLLAMA_API_KEY",
  "QWENCLOUD_API_KEY",
  "DASHSCOPE_API_KEY",
] as const;

export function withoutProviderEnv(): () => void {
  const saved = new Map<string, string | undefined>();
  for (const name of PROVIDER_ENV_VARS) {
    saved.set(name, process.env[name]);
    delete process.env[name];
  }
  return () => {
    for (const [name, value] of saved) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  };
}