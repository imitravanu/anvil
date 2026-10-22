import { useMemo, useState } from "react";
import { Box, Text, useStdout } from "ink";
import { CORE_VERSION, TOOL_DEFINITIONS } from "@anvil/core";
import type { DisplayMessage } from "../hooks/useAgentController.js";
import { useTheme } from "../theme/theme.js";
import { MessageView } from "./MessageView.js";
import { WordmarkAnimation, wordmarkMode } from "./Wordmark.js";
import { detectColorSupport } from "../theme/colorSupport.js";
import { displayModelLabel, providerLabel, providerOfModel } from "../util/format.js";
import { hiddenMessageCount, applyTranscriptPin } from "../util/transcriptWindow.js";
import { TranscriptViewport } from "./TranscriptViewport.js";

function EmptyState({ model, providerId, minimal = false }: { model: string; providerId?: string; minimal?: boolean }) {
  const theme = useTheme();
  const provider = providerOfModel(model, providerId);
  const { stdout } = useStdout();
  const [settled, setSettled] = useState(false);
  // The mode decision is a pure function (see Wordmark.tsx) so every branch is
  // testable without a TTY. Hooks stay above it: the order never varies.
  const mode = wordmarkMode({
    cols: stdout?.columns ?? 80,
    rows: stdout?.rows ?? 24,
    isTTY: stdout?.isTTY,
    noColor: detectColorSupport() === "none",
    noAnim: process.env.ANVIL_NO_ANIM === "1",
  });
  // The hints ARE the onboarding contract, so they are never held back longer
  // than the animation: a plain fallback shows them at once, and the animated
  // path reveals them the moment the wordmark settles.
  const showHints = mode !== "animate" || settled;
  if (minimal) return <Box flexDirection="column" paddingX={1} flexGrow={1} justifyContent="center">
    <Text color={theme.colors.textPrimary} bold>What would you like to work on?</Text>
    <Text color={theme.colors.textSecondary}>Describe a change, ask a question, or / for commands.</Text>
  </Box>;
  return (
    <Box flexDirection="column" alignItems="center" justifyContent="center" flexGrow={1}>
      {mode === "plain" ? (
        // Phase 41: the wordmark's plain fallback is the THEME's brand name
        // (a custom theme can call itself something else). The animated pixel
        // wordmark above spells ANVIL by construction — a bitmap, not text.
        <Text color={theme.colors.primary} bold>
          {theme.typography.brandName.toLowerCase()}
        </Text>
      ) : (
        <WordmarkAnimation skipAnimation={mode === "static"} onSettled={() => setSettled(true)} />
      )}
      {showHints && (
        <>
          <Text color={theme.colors.textSecondary}>Terminal coding agent</Text>
          <Text color={theme.colors.textSecondary}>
            {provider ? providerLabel(provider) : "Anvil"} · {displayModelLabel(model, providerId)}
          </Text>
          <Box marginTop={1} gap={1}>
            {/* Derived from the registry so the advertised count cannot drift the way
                the README's hardcoded "15 Built-in Tools" did (Phase 33). */}
            <Text color={theme.colors.brand}>◈ {TOOL_DEFINITIONS.length} tools</Text>
            <Text color={theme.colors.textMuted}>·</Text>
            <Text color={theme.colors.accent}>⚡ AST code graph</Text>
            <Text color={theme.colors.textMuted}>·</Text>
            <Text color={theme.colors.success}>✓ continuous LSP</Text>
          </Box>
          <Box marginTop={1} flexDirection="column">
            <Text color={theme.colors.userText}>Just type a task — I can read, edit, and run code in this project.</Text>
          </Box>
          <Box marginTop={1}>
            {/* Phase 41: the keyboard contract, on the first screen. Off-TTY
                (tests) it is static text; the `?` key is what opens the
                searchable reference in the running app. */}
            <Text color={theme.colors.textMuted}>
              ↵ send · ↑/↓ history · PgUp/PgDn scroll · ? help
            </Text>
          </Box>
          <Box marginTop={1} flexDirection="column">
            <Text color={theme.colors.textSecondary}>Try:</Text>
            <Text><Text color={theme.colors.primary}>/help</Text><Text color={theme.colors.textSecondary}> — every key & command</Text></Text>
            <Text><Text color={theme.colors.primary}>/model</Text><Text color={theme.colors.textSecondary}> — switch model or provider</Text></Text>
            <Text><Text color={theme.colors.primary}>/goal</Text><Text color={theme.colors.textSecondary}> — autonomous mission with plan & critique</Text></Text>
            <Text><Text color={theme.colors.primary}>/diff</Text><Text color={theme.colors.textSecondary}> — review file changes & unified diffs</Text></Text>
            <Text><Text color={theme.colors.primary}>/session</Text><Text color={theme.colors.textSecondary}> — resume a past conversation</Text></Text>
          </Box>
          <Box marginTop={1}>
            <Text color={theme.colors.textSecondary}>v{CORE_VERSION}</Text>
          </Box>
        </>
      )}
    </Box>
  );
}

export function MessageList({ messages, model, providerId, expandTools, pinnedBack, rowScroll = false, onBounds }: { messages: DisplayMessage[]; model: string; providerId?: string; expandTools?: boolean; pinnedBack?: number; rowScroll?: boolean; onBounds?: (maximum: number, anchoredOffset: number) => void }) {
  const theme = useTheme();
  const { stdout } = useStdout();
  const termRows = stdout?.rows ?? 24;
  // Row budget for the "N earlier messages" honesty indicator, estimated from
  // the terminal size minus chrome reserve. The container itself is flex-sized
  // (no explicit height) so Yoga — not stale rows arithmetic — owns layout.
  // DW-2 framed chrome at 30 rows: frame borders (2) + header frame (3) + the
  // two dividers flanking the transcript (2) + input box incl. borders (3) +
  // status bar frame (3) = 13, plus 1 line of slack — 14 total. The
  // plan/queued HUD renders BELOW the transcript divider (outside this
  // region); Yoga then gives the list exactly what the chrome leaves.
  const rowBudget = Math.max(3, termRows - 14);
  const width = stdout?.columns ?? 80;
  // Memoized: this walks every message on every render, and spinners tick at
  // 80 ms during a busy turn.
  const hidden = useMemo(
    () => hiddenMessageCount(messages, width, rowBudget, expandTools ?? false),
    [messages, width, rowBudget, expandTools]
  );
  // Keyboard scroll window: pinning holds back newest messages (0 = follow).
  const { start, end, pinned } = applyTranscriptPin(messages.length, hidden, pinnedBack ?? 0);
  if (rowScroll) {
    if (!messages.length) return <EmptyState minimal model={model} providerId={providerId} />;
    return <Box flexDirection="column" flexGrow={1} minHeight={0} paddingX={1}>
      <TranscriptViewport messages={messages} expanded={expandTools ?? false} offset={pinnedBack ?? 0} onBounds={onBounds} />
      {(pinnedBack ?? 0) > 0 && <Text color={theme.colors.textSecondary}>Reading earlier output · Tab, then End to follow · Ctrl+O details</Text>}
    </Box>;
  }
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
        <EmptyState model={model} providerId={providerId} />
      </Box>
    );
  }
  // Two stacked zones: the "… N earlier messages" indicator sits OUTSIDE the
  // bottom-anchored clip. Inside it, the indicator was the first row the flex
  // clip ate whenever the newest message itself overflowed — the user's turn
  // vanished with no trace, as if the message had never been sent.
  return (
    <Box flexDirection="column" flexGrow={1} flexShrink={1} minHeight={0} overflow="hidden" paddingX={1}>
      {hidden > 0 && start > 0 && (
        <Box flexShrink={0}>
          <Text color={theme.colors.textSecondary}>
            … {start} earlier message{start === 1 ? "" : "s"} above — full history in the session file
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
        {messages.slice(start, end).map((message, index) => (
          <Box key={message.id} marginTop={index > 0 ? 1 : 0} flexShrink={0}>
            <MessageView message={message} expandTools={expandTools} />
          </Box>
        ))}
      </Box>
      {pinned > 0 && (
        <Box flexShrink={0}>
          <Text color={theme.colors.textSecondary}>
            ↓ {pinned} newer below — PgDn to follow
          </Text>
        </Box>
      )}
    </Box>
  );
}
