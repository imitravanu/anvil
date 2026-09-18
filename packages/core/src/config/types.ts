export interface AnvilSettings {
  defaultProviderId?: string;
  defaultModel?: string;
  theme?: string; // theme name, see packages/tui/src/theme/themes.ts
  autoCommit?: boolean; // auto-commit per goal milestone (default false)
  compactionModel?: string; // separate designated summarizer model
  /** DW-4.9 turn notifications; both default true when absent. */
  notifications?: {
    desktop?: boolean;
    sound?: boolean;
  };
}