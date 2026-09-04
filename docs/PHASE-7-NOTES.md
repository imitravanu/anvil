# Phase 7 Notes

## More providers, all chat-completions compatible

- Added five providers on top of the original four — **Groq**, **GitHub Models**,
  **Cerebras**, **Mistral AI**, and **Ollama (local)**. That brings Anvil to nine
  providers behind one interface. The four paid/established providers
  (Anthropic, OpenAI, Gemini, OpenRouter) keep their native adapters.
- All five new providers speak the OpenAI chat-completions protocol, so they are
  thin adapter files around the shared `createChatCompletionsStyleProvider` engine
  (one `baseURL`/key/display-name each) — no duplicated streaming-parse code.
- Ollama is special-cased: `OLLAMA_HOST` overrides the default
  `http://localhost:11434/v1`, no key is required (a dummy `ollama` credential
  satisfies the config layer), and traffic never leaves the machine.

## Free-model awareness

- `ModelInfo` gained an `isFree?: boolean` tri-state. `true` = no charge,
  `false` = explicitly paid, `undefined` = unclassified (legacy entries).
- The `/model` picker and the header/status bar render `[FREE]` / `[PAID]` tags
  derived straight from the registry so pricing is never hidden.
- Free-model providers (Groq, GitHub Models, Cerebras, Mistral, Ollama) are listed
  in `FirstRunSetup` with their free-tier pitch, and their models are registered
  with `isFree: true` in `MODEL_REGISTRY`.

## OpenRouter live free-model sync

- `syncOpenRouterModels()` fetches `GET /models` (public, no auth needed), builds a
  set of currently-free models (zero prompt & completion price, or `:free` suffix /
  `openrouter/free`), then:
  - demotes registry models that became paid (marks `[PAID]`),
  - promotes/models that became free (marks `[FREE]`),
  - registers brand-new free models via `registerModel()`.
- Runs automatically at startup when OpenRouter is configured (`packages/cli`) and
  when the model picker opens, and on demand via the new `/sync` slash command.
- The merged registry is cached to `~/.anvil/models-cache.json` so model availability
  survives restarts; `registerModels()` at boot restores the snapshot before the UI
  needs it (idempotent by model id — updates in place, no duplicates).

## Known limitations

- Pricing classification is OpenRouter's own; free-tier *quota* limits (e.g.
  requests/minute, availability) are not tracked — a `[FREE]` model can still return
  429s when a provider's free quota is exhausted.
- The models cache is a best-effort snapshot; a corrupt/missing file is silently
  ignored (`loadModelsCache` returns `[]`).
- `syncOpenRouterModels` and `fetchOpenRouterFreeModels` both swallow network errors
  and return empty/zero results rather than surfacing them — background sync must
  never block the app.