import { useState } from "react";
import { Box, Text, useInput } from "ink";
import { listSessions } from "@anvil/core";
import { useTheme } from "../theme/theme.js";
import { curtail, displayModelLabel } from "../util/format.js";
import { SESSION_TITLE_MAX, MAX_VISIBLE_ROWS } from "../util/displayLimits.js";
import { useWindowedList } from "../hooks/useWindowedList.js";

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

const MAX_VISIBLE = MAX_VISIBLE_ROWS;

/**
 * Session picker overlay. Same "takes over input" pattern as
 * PermissionPrompt/ModelPicker — App renders it in place of InputBar.
 */
export function SessionPicker({
  onSelect,
  onClose,
}: {
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  const theme = useTheme();
  const sessions = listSessions(); // already sorted most-recent-first
  const [selected, setSelected] = useState(0);

  useInput((_input, key) => {
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

  const { offset: scrollOffset, hasAbove, hasBelow } = useWindowedList(sessions.length, selected);
  const visibleSessions = sessions.slice(scrollOffset, scrollOffset + MAX_VISIBLE);

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.colors.primary} paddingX={1}>
      <Text color={theme.colors.primary}>
        Saved sessions{sessions.length > 0 ? ` (${selected + 1}/${sessions.length})` : ""} — Enter to resume, Esc to cancel
      </Text>
      {sessions.length === 0 ? (
        <Text dimColor>No saved sessions yet.</Text>
      ) : (
        <>
          {hasAbove && <Text dimColor>  ▲ {scrollOffset} more above...</Text>}
          {visibleSessions.map((meta, i) => {
            const globalIndex = scrollOffset + i;
            const isSelected = globalIndex === selected;
            return (
              <Text key={meta.id} color={isSelected ? theme.colors.primary : undefined}>
                {isSelected ? "❯ " : "  "}
                {curtail(meta.title, SESSION_TITLE_MAX)} · {displayModelLabel(meta.model)} · updated {relativeTime(meta.updatedAt)}
              </Text>
            );
          })}
          {hasBelow && (
            <Text dimColor>  ▼ {sessions.length - (scrollOffset + MAX_VISIBLE)} more below...</Text>
          )}
        </>
      )}
    </Box>
  );
}