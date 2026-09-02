import { useCallback, useState } from "react";
import { Box, useStdout } from "ink";
import type { AgentSession, ModelInfo, ModelProvider, ProviderId } from "@anvil/core";
import type { TuiPermissionBroker } from "../permission/TuiPermissionBroker.js";
import { useAgentController } from "../hooks/useAgentController.js";
import { usePermissionBroker } from "../hooks/usePermissionBroker.js";
import { COMMANDS, parseCommand } from "../commands/registry.js";
import type { CommandContext } from "../commands/types.js";
import { Header } from "./Header.js";
import { InputBar } from "./InputBar.js";
import { MessageList } from "./MessageList.js";
import { ModelPicker } from "./ModelPicker.js";
import { PermissionPrompt } from "./PermissionPrompt.js";
import { StatusBar } from "./StatusBar.js";

export interface AppProps {
  session: AgentSession;
  broker: TuiPermissionBroker;
  providers: Record<ProviderId, ModelProvider>;
  model: string;
}

export function App({ session, broker, providers, model }: AppProps) {
  const {
    messages,
    isBusy,
    usage,
    send,
    cancel,
    printSystemMessage,
    clearMessages,
  } = useAgentController(session);
  const { stdout } = useStdout();
  const rows = stdout?.rows ?? 24;

  const pendingPermission = usePermissionBroker(broker);
  const [currentModel, setCurrentModel] = useState(model);
  const [isModelPickerOpen, setIsModelPickerOpen] = useState(false);

  const commandContext: CommandContext = {
    clearHistory: () => {
      session.clearHistory();
      clearMessages();
    },
    openModelPicker: () => setIsModelPickerOpen(true),
    printSystemMessage,
  };

  const handleSubmit = useCallback(
    (text: string) => {
      const parsed = parseCommand(text);
      if (parsed) {
        const command = COMMANDS.find((c) => c.name === parsed.name);
        if (command) {
          command.run(parsed.args, commandContext);
        } else {
          printSystemMessage(`Unknown command: /${parsed.name}. Try /help.`);
        }
        return;
      }
      send(text);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [send, session, printSystemMessage, clearMessages]
  );

  const handleModelSelect = useCallback(
    (provider: ModelProvider, modelInfo: ModelInfo) => {
      const result = session.switchModel(provider, modelInfo.id);
      if (result.historyCleared) {
        printSystemMessage(
          `Switched to ${provider.id}/${modelInfo.id} — conversation history was cleared (different provider).`
        );
      } else {
        printSystemMessage(`Switched to ${provider.id}/${modelInfo.id}.`);
      }
      setCurrentModel(modelInfo.id);
      setIsModelPickerOpen(false);
    },
    [session, printSystemMessage]
  );

  const handleModelPickerClose = useCallback(() => setIsModelPickerOpen(false), []);

  return (
    <Box flexDirection="column" height={rows} width={stdout?.columns ?? 80}>
      <Header model={currentModel} />
      <MessageList messages={messages} />
      {/* Overlays take over keyboard input — InputBar is not rendered while one is open,
          so keystrokes can never leak into it. */}
      {pendingPermission ? (
        <PermissionPrompt request={pendingPermission} broker={broker} />
      ) : isModelPickerOpen ? (
        <ModelPicker
          providers={providers}
          currentModelId={currentModel}
          onSelect={handleModelSelect}
          onClose={handleModelPickerClose}
        />
      ) : (
        <InputBar isBusy={isBusy} onSubmit={handleSubmit} onCancel={cancel} />
      )}
      <StatusBar model={currentModel} isBusy={isBusy} usage={usage} />
    </Box>
  );
}
