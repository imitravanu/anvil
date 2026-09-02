export interface CommandContext {
  clearHistory: () => void;
  openModelPicker: () => void;
  printSystemMessage: (text: string) => void; // shows a message in the transcript, not sent to the model
}

export interface Command {
  name: string; // without the leading slash
  description: string;
  run: (args: string[], ctx: CommandContext) => void;
}