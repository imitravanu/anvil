# @imitravanu/anvil-core

Core autonomous agent loop, provider adapters, session management, LSP intelligence, and tooling for [Anvil](https://github.com/imitravanu/anvil).

## Features

- **Multi-Provider AI Adapters**: Built-in support for 13 LLM providers (Anthropic, OpenAI, Google Gemini, Groq, Mistral, Ollama, OpenRouter, and more) plus generic OpenAI-compatible custom endpoints.
- **Autonomous Tooling**: 16 built-in tools for AST parsing, code modification, file inspection, command execution, and test verification.
- **LSP Code Intelligence**: Diagnostics, definition lookup, references, and hover support across TypeScript, Python, Rust, and more.
- **Session Checkpoints**: Pre-mutation file snapshots for instant rewinding and rollback safety.
- **Native Guardian Gate**: Anti-slop interceptors, syntax sanity checks, and verification pipelines.

## Installation

```bash
npm install @imitravanu/anvil-core
```

For the standalone terminal coding agent CLI, install [@imitravanu/anvil-cli](https://www.npmjs.com/package/@imitravanu/anvil-cli):

```bash
npm install -g @imitravanu/anvil-cli
```

## Documentation

Full documentation, architecture guides, and source code are available at [https://github.com/imitravanu/anvil](https://github.com/imitravanu/anvil).

## License

MIT © [mitravanu](https://github.com/imitravanu)
