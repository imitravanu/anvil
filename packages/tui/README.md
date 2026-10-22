# @imitravanu/anvil-tui

Terminal User Interface (TUI) for [Anvil](https://github.com/imitravanu/anvil), built with [Ink](https://github.com/vadimdemedes/ink) (React for the terminal).

## Features

- **Conversation-First Layout**: Clean, responsive terminal design with multiline input composer and virtualized scrollable transcript.
- **Interactive Diff Review**: Real-time unified diff preview for filesystem mutations with single-key consent (`Allow once` / `Always allow` / `Deny`).
- **Mouse & Trackpad Support**: Full trackpad/wheel scrolling and drag-to-select text with automatic copy-to-clipboard on release.
- **Model & Session Pickers**: Keyboard-navigable overlays for hot-swapping LLM models and restoring past conversation checkpoints.
- **Theming**: Dark, Light, Forge, and High-Contrast terminal themes with responsive layout tiers (6 sizes × 3 themes).

## Installation

```bash
npm install @imitravanu/anvil-tui
```

For the standalone terminal coding agent CLI, install [@imitravanu/anvil-cli](https://www.npmjs.com/package/@imitravanu/anvil-cli):

```bash
npm install -g @imitravanu/anvil-cli
```

## Documentation

Full documentation, architecture guides, and source code are available at [https://github.com/imitravanu/anvil](https://github.com/imitravanu/anvil).

## License

MIT © [mitravanu](https://github.com/imitravanu)
