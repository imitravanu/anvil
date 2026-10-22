import { useState } from "react";
import { Box, Text, useStdout } from "ink";
import { useInput, usePaste } from "../hooks/useUIInput.js";
import { listSessions } from "@imitravanu/anvil-core";
import { useTheme } from "../theme/theme.js";
import { curtail, displayModelLabel, relativeTime } from "../util/format.js";
import { OverlayFrame } from "./OverlayFrame.js";
import { SESSION_TITLE_MAX, MAX_VISIBLE_ROWS } from "../util/displayLimits.js";
import { useWindowedList } from "../hooks/useWindowedList.js";
import { sanitizeTerminalText } from "../util/sanitize.js";

const MAX_VISIBLE = MAX_VISIBLE_ROWS;

/**
 * Session picker overlay. Same "takes over input" pattern as
 * PermissionPrompt/ModelPicker — App renders it in place of InputBar.
 */
export function SessionPicker({
  minimal = false,
  onSelect,
  onClose,
}: {
  minimal?: boolean;
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  const theme = useTheme();
  const { stdout } = useStdout();
  const visibleRows = minimal ? Math.max(1, Math.min(MAX_VISIBLE, (stdout?.rows ?? 24) - 9)) : MAX_VISIBLE;
  // Load once per mount (initializer), never in the render body: the old
  // per-render listSessions() re-scanned the sessions dir on every parent
  // re-render, and a corrupt dir threw inside render and crashed the frame.
  const [loaded] = useState(() => {
    try {
      return { sessions: listSessions(), failed: false };
    } catch {
      // intentional: a corrupt sessions dir reads as empty — never crash the frame.
      return { sessions: [], failed: true };
    }
  });
  const sessions = loaded.sessions; // already sorted most-recent-first
  const [selected, setSelected] = useState(0);

  usePaste(() => { /* intentional: pasted Enter must never resume a conversation. */ });
  useInput((_input, key) => {
    if (key.ctrl || key.meta) return;
    if (key.escape) {
      onClose();
      return;
    }
    if (sessions.length === 0) return;
    if (key.upArrow) setSelected((s) => Math.max(0, s - 1));
    else if (key.downArrow) setSelected((s) => Math.min(sessions.length - 1, s + 1));
    else if (key.return) {
      const session = sessions[selected];
      if (session) onSelect(session.id);
    }
  });

  const { offset: scrollOffset, hasAbove, hasBelow } = useWindowedList(sessions.length, selected, visibleRows);
  const visibleSessions = sessions.slice(scrollOffset, scrollOffset + visibleRows);

  return (
    <OverlayFrame
      minimal={minimal}
      title="Saved sessions"
      meta={sessions.length > 0 ? `(${selected + 1}/${sessions.length})` : undefined}
      hints="↑/↓ · Enter resume · Esc cancel"
    >
      {loaded.failed ? (
        <Text color={theme.colors.toolError}>Could not load saved sessions (sessions dir unreadable).</Text>
      ) : sessions.length === 0 ? (
        <Text color={theme.colors.textSecondary}>No saved sessions yet.</Text>
      ) : (
        <>
          {hasAbove && <Text color={theme.colors.textSecondary}>  ▲ {scrollOffset} more above...</Text>}
          {visibleSessions.map((meta, i) => {
            const globalIndex = scrollOffset + i;
            const isSelected = globalIndex === selected;
            return (
              <Text key={meta.id} color={isSelected ? theme.colors.primary : theme.colors.userText} wrap={minimal ? "truncate-end" : "wrap"}>
                {isSelected ? "❯ " : "  "}
                {curtail(sanitizeTerminalText(meta.title).replace(/\n/g, " "), SESSION_TITLE_MAX)} · {sanitizeTerminalText(displayModelLabel(meta.model, meta.providerId)).replace(/\n/g, " ")} · updated {relativeTime(meta.updatedAt)}
              </Text>
            );
          })}
          {hasBelow && (
            <Text color={theme.colors.textSecondary}>  ▼ {sessions.length - (scrollOffset + visibleRows)} more below...</Text>
          )}
        </>
      )}
    </OverlayFrame>
  );
}
