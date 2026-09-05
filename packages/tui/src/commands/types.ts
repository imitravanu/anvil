export interface CommandContext {
  clearHistory: () => void;
  openModelPicker: () => void;
  printSystemMessage: (text: string) => void; // shows a message in the transcript, not sent to the model
  // /session subcommands (Phase 5)
  sessionList: () => void;
  sessionNew: () => void;
  sessionResume: (id?: string) => void; // no id → open the SessionPicker overlay
  sessionRename: (title: string) => void;
  // /theme (Phase 6): switch + persist; handler validates the name
  setTheme: (name: string) => void;
  // /connect: open the provider-key setup overlay (add/update a key in-app)
  openConnect: () => void;
  // /ledger (U7): print this session's run-ledger audit report
  showLedger: () => void;
  // /expand (U6): toggle full tool-output display in the transcript
  toggleExpand: () => void;
  // /rewind (checkpoints): no id → list; id → restore that checkpoint
  rewind: (idText?: string) => void;
  // /mcp (Phase 10): no arg → server status; "reconnect" → refresh all
  mcp: (sub?: string) => void;
}

export interface Command {
  name: string; // without the leading slash
  description: string;
  run: (args: string[], ctx: CommandContext) => void;
}