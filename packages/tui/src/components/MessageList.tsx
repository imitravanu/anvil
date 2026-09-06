import { useMemo } from "react";
import { Box, Text, useStdout } from "ink";
import { CORE_VERSION } from "@anvil/core";
import type { DisplayMessage } from "../hooks/useAgentController.js";
import { useTheme } from "../theme/theme.js";
import { MessageView } from "./MessageView.js";
import { displayModelLabel, providerLabel, providerOfModel } from "../util/format.js";
import { hiddenMessageCount } from "../util/transcriptWindow.js";

function EmptyState({ model }: { model: string }) {
  const theme = useTheme();
  const provider = providerOfModel(model);
  return (
    <Box flexDirection="column" alignItems="center" justifyContent="center" flexGrow={1}>
      <Text color={theme.colors.primary} bold>▲ ANVIL</Text>
      <Text dimColor>Terminal coding agent</Text>
      <Text dimColor>
        {provider ? providerLabel(provider) : "Anvil"} · {displayModelLabel(model)}
      </Text>
      <Box marginTop={1} flexDirection="column">
        <Text>Just type a task — I can read, edit, and run code in this project.</Text>
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Text dimColor>Try:</Text>
        <Text><Text color={theme.colors.primary}>/help</Text><Text dimColor> — list commands</Text></Text>
        <Text><Text color={theme.colors.primary}>/model</Text><Text dimColor> — switch model or provider</Text></Text>
        <Text><Text color={theme.colors.primary}>/session</Text><Text dimColor> — resume a past conversation</Text></Text>
        <Text><Text color={theme.colors.primary}>/connect</Text><Text dimColor> — add or update a provider API key</Text></Text>
      </Box>
      <Box marginTop={1}>
        <Text dimColor>v{CORE_VERSION}</Text>
      </Box>
    </Box>
  );
}

export function MessageList({ messages, model, expandTools }: { messages: DisplayMessage[]; model: string; expandTools?: boolean }) {
  const { stdout } = useStdout();
  const termRows = stdout?.rows ?? 24;
  // Row budget for the "N earlier messages" honesty indicator, estimated from
  // the terminal size minus chrome reserve. The container itself is flex-sized
  // (no explicit height) so Yoga — not stale rows arithmetic — owns layout.
  // The reserve covers header+dividers+status bar (6), input bar (~3), and the
  // plan/queued HUD (up to 3): the estimator may then err on the visible side.
  const rowBudget = Math.max(3, termRows - 12);
  const width = stdout?.columns ?? 80;
  // Memoized: this walks every message on every render, and spinners tick at
  // 80 ms during a busy turn.
  const hidden = useMemo(
    () => hiddenMessageCount(messages, width, rowBudget, expandTools ?? false),
    [messages, width, rowBudget, expandTools]
  );
  // Shared bounded container for both states: bottom-anchored, clipped at the
  // top exactly like terminal scrollback. No explicit height here: the parent
  // frame is height={rows} and every chrome zone is flexShrink={0}, so this
  // flexGrow={1} + minHeight={0} + overflow="hidden" region is the ONLY element
  // allowed to shrink. The previous explicit height={rows-9} fought Yoga when
  // overlays (slash menu, permission prompt, DiffModal, MissionDeck) grew —
  // total rows exceeded the frame and turns/chrome overwrote shared rows.
  if (messages.length === 0) {
    return (
      <Box
        flexDirection="column"
        flexGrow={1}
        flexShrink={1}
        minHeight={0}
        overflow="hidden"
        justifyContent="center"
      >
        <EmptyState model={model} />
      </Box>
    );
  }
  return (
    <Box
      flexDirection="column"
      flexGrow={1}
      flexShrink={1}
      minHeight={0}
      overflow="hidden"
      paddingX={1}
      justifyContent="flex-end"
    >
      {hidden > 0 && (
        <Text dimColor>… {hidden} earlier message{hidden === 1 ? "" : "s"} above — full history in the session file</Text>
      )}
      {messages.map((message, index) => (
        <Box key={message.id} marginTop={index > 0 ? 1 : 0} flexShrink={0}>
          <MessageView message={message} expandTools={expandTools} />
        </Box>
      ))}
    </Box>
  );
}
