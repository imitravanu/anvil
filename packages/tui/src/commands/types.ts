export interface CommandContext {
  clearHistory: () => void;
  openModelPicker: () => void;
  printSystemMessage: (text: string) => void; // shows a message in the transcript, not sent to the model
  // /session subcommands (Phase 5)
  sessionList: () => void;
  sessionNew: () => void;
  sessionResume: (id?: string) => void; // no id → open the SessionPicker overlay
  sessionRename: (title: string) => void;
}

export interface Command {
  name: string; // without the leading slash
  description: string;
  run: (args: string[], ctx: CommandContext) => void;
}