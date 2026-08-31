import { Box, useStdout } from "ink";
import type { DisplayMessage } from "../hooks/useAgentController.js";
import { MessageView } from "./MessageView.js";

export function MessageList({ messages }: { messages: DisplayMessage[] }) {
  const { stdout } = useStdout();
  const rows = stdout?.rows ?? 24;
  // Ink has no native scroll — approximate "last N that fit" by capping the
  // number of rendered messages relative to the terminal height. Each message
  // is at least one line; ~2 rows per message keeps the panel from overflowing.
  const maxMessages = Math.max(1, Math.floor((rows - 6) / 2));
  const visible = messages.slice(-maxMessages);
  return (
    <Box flexDirection="column" flexGrow={1} paddingX={1} justifyContent="flex-end">
      {visible.map((message) => (
        <MessageView key={message.id} message={message} />
      ))}
    </Box>
  );
}
