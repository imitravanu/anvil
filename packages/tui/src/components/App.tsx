import { Box, useStdout } from "ink";
import type { AgentSession } from "@anvil/core";
import { useAgentController } from "../hooks/useAgentController.js";
import { Header } from "./Header.js";
import { InputBar } from "./InputBar.js";
import { MessageList } from "./MessageList.js";
import { StatusBar } from "./StatusBar.js";

export interface AppProps {
  session: AgentSession;
  model: string;
}

export function App({ session, model }: AppProps) {
  const { messages, isBusy, usage, send, cancel } = useAgentController(session);
  const { stdout } = useStdout();
  const rows = stdout?.rows ?? 24;

  return (
    <Box flexDirection="column" height={rows} width={stdout?.columns ?? 80}>
      <Header model={model} />
      <MessageList messages={messages} />
      <InputBar isBusy={isBusy} onSubmit={send} onCancel={cancel} />
      <StatusBar model={model} isBusy={isBusy} usage={usage} />
    </Box>
  );
}
