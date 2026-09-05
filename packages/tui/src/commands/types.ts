import type { Dispatch, SetStateAction } from "react";
import type {
  AgentOptions,
  AgentSession,
  ModelProvider,
  ProviderId,
  StoredSession,
} from "@anvil/core";
import type { TuiPermissionBroker } from "../permission/TuiPermissionBroker.js";
import type { DisplayMessage } from "../hooks/useAgentController.js";
import type { McpAppState } from "../components/App.js";

export interface CommandContext {
  clearHistory: () => void;
  openModelPicker: () => void;
  printSystemMessage: (text: string) => void; // shows a message in the transcript, not sent to the model
  // /session subcommands
  sessionList: () => void;
  sessionNew: () => void;
  sessionResume: (id?: string) => void; // no id → open the SessionPicker overlay
  sessionRename: (title: string) => void;
  // /theme: switch + persist; handler validates the name. No name → open
  // the interactive picker.
  setTheme: (name: string) => void;
  openThemePicker: () => void;
  // /connect: open the provider-key setup overlay (add/update a key in-app)
  openConnect: () => void;
  // /ledger print this session's run-ledger audit report
  showLedger: () => void;
  // /expand toggle full tool-output display in the transcript
  toggleExpand: () => void;
  // /rewind (checkpoints): no id → list; id → restore that checkpoint
  rewind: (idText?: string) => void;
  // /mcp: no arg → server status; "reconnect" → refresh all
  mcp: (sub?: string) => void;
}

export interface Command {
  name: string; // without the leading slash
  description: string;
  run: (args: string[], ctx: CommandContext) => void;
}

/**
 * P3 single-touch commands: everything a command handler needs, in one
 * object. Adding a command = one registry entry + (if it needs session
 * access) one method here, implemented once in makeHandlers. App.tsx and
 * hooks never change for new commands.
 */
export interface CommandHandlerDeps {
  session: AgentSession;
  providers: Record<ProviderId, ModelProvider>;
  activeProviderId: ProviderId;
  currentModel: string;
  sessionOptions: Omit<AgentOptions, "permissionBroker" | "model">;
  broker: TuiPermissionBroker;
  mcp?: McpAppState;
  isBusy: boolean;
  printSystemMessage: (text: string) => void;
  clearMessages: () => void;
  replaceMessages: (seed: DisplayMessage[]) => void;
  persist: () => void;
  resumeFromStored: (stored: StoredSession) => void;
  applyTheme: (name: string) => void;
  setSession: Dispatch<SetStateAction<AgentSession>>;
  setIsModelPickerOpen: Dispatch<SetStateAction<boolean>>;
  setIsSessionPickerOpen: Dispatch<SetStateAction<boolean>>;
  setIsConnectOpen: Dispatch<SetStateAction<boolean>>;
  setIsThemePickerOpen: Dispatch<SetStateAction<boolean>>;
  setExpandTools: Dispatch<SetStateAction<boolean>>;
}

export type CommandHandlerFactory = (deps: CommandHandlerDeps) => CommandContext;