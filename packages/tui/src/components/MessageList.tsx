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
      <Text color={theme.colors.dim}>Terminal coding agent</Text>
      <Text color={theme.colors.dim}>
        {provider ? providerLabel(provider) : "Anvil"} · {displayModelLabel(model)}
      </Text>
      <Box marginTop={1} flexDirection="column">
        <Text color={theme.colors.userText}>Just type a task — I can read, edit, and run code in this project.</Text>
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Text color={theme.colors.dim}>Try:</Text>
        <Text><Text color={theme.colors.primary}>/help</Text><Text color={theme.colors.dim}> — list commands</Text></Text>
        <Text><Text color={theme.colors.primary}>/model</Text><Text color={theme.colors.dim}> — switch model or provider</Text></Text>
        <Text><Text color={theme.colors.primary}>/session</Text><Text color={theme.colors.dim}> — resume a past conversation</Text></Text>
        <Text><Text color={theme.colors.primary}>/connect</Text><Text color={theme.colors.dim}> — add or update a provider API key</Text></Text>
      </Box>
      <Box marginTop={1}>
        <Text color={theme.colors.dim}>v{CORE_VERSION}</Text>
      </Box>
    </Box>
  );
}

export function MessageList({ messages, model, expandTools }: { messages: DisplayMessage[]; model: string; expandTools?: boolean }) {
  const theme = useTheme();
  const { stdout } = useStdout();
  const termRows = stdout?.rows ?? 24;
  // Row budget for the "N earlier messages" honesty indicator, estimated from
  // the terminal size minus chrome reserve. The container itself is flex-sized
  // (no explicit height) so Yoga — not stale rows arithmetic — owns layout.
  // Measured chrome at 30 rows: frame borders (2) + header (1) + the two
  // dividers flanking the transcript (2) + input box incl. borders (3) +
  // status bar (1) = 9, plus 1 line of slack — 10 total. The plan/queued HUD
  // renders BELOW the transcript divider (outside this region); Yoga then
  // gives the list exactly what the chrome leaves. This reserve matches the
  // measured 30-row layout (transcript = rows - 10 = 20).
  const rowBudget = Math.max(3, termRows - 10);
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
  // Two stacked zones: the "… N earlier messages" indicator sits OUTSIDE the
  // bottom-anchored clip. Inside it, the indicator was the first row the flex
  // clip ate whenever the newest message itself overflowed — the user's turn
  // vanished with no trace, as if the message had never been sent.
  return (
    <Box flexDirection="column" flexGrow={1} flexShrink={1} minHeight={0} overflow="hidden" paddingX={1}>
      {hidden > 0 && (
        <Box flexShrink={0}>
          <Text color={theme.colors.dim}>
            … {hidden} earlier message{hidden === 1 ? "" : "s"} above — full history in the session file
          </Text>
        </Box>
      )}
      <Box
        flexDirection="column"
        flexGrow={1}
        flexShrink={1}
        minHeight={0}
        overflow="hidden"
        justifyContent="flex-end"
      >
        {messages.slice(hidden).map((message, index) => (
          <Box key={message.id} marginTop={index > 0 ? 1 : 0} flexShrink={0}>
            <MessageView message={message} expandTools={expandTools} />
          </Box>
        ))}
      </Box>
    </Box>
  );
}
