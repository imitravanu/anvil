export interface AnvilSettings {
  defaultProviderId?: string;
  defaultModel?: string;
  theme?: string; // theme name, see packages/tui/src/theme/themes.ts
  autoCommit?: boolean; // auto-commit per goal milestone (default false)
}