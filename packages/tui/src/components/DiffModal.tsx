import { useEffect, useState } from "react";
import { Box, Text, useInput, useStdout } from "ink";
import type { AgentSession, SessionFileChange } from "@anvil/core";
import { useTheme } from "../theme/theme.js";
import { ColorizedDiff } from "../diff/colorizeDiff.js";
import { curtail } from "../util/format.js";

export interface BranchDiffInfo {
  branch: string;
  diff: string;
}

export interface DiffModalProps {
  session: AgentSession;
  onClose: () => void;
  branchDiff?: BranchDiffInfo | null;
}

/** Tabs visible in the strip at once — the strip must stay a single row. */
function visibleTabs(width: number): number {
  return Math.max(1, Math.floor((width - 4) / 28));
}

export function DiffModal({ session, onClose, branchDiff }: DiffModalProps) {
  const theme = useTheme();
  const { stdout } = useStdout();
  const termWidth = stdout?.columns ?? 80;
  const termRows = stdout?.rows ?? 24;
  // App chrome (frame border, header, dividers, status bar) costs 6 rows and
  // the plan/queued HUD can add 1-2 more; reserving 8 keeps the modal inside
  // the frame instead of pushing the status bar past the bottom border.
  const height = Math.max(10, termRows - 8);

  const [changes, setChanges] = useState<SessionFileChange[]>([]);
  const [activeIdx, setActiveIdx] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(!branchDiff);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (branchDiff !== undefined && branchDiff !== null) {
      setLoading(false);
      return;
    }
    let active = true;
    void session
      .summarizeChanges()
      .then((list) => {
        if (active) {
          setChanges(list);
          setLoading(false);
        }
      })
      .catch((err: unknown) => {
        // A rejected summarize must not leave the modal stuck on the spinner.
        if (active) {
          setError(err instanceof Error ? err.message : String(err));
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [session, branchDiff]);

  useInput((input, key) => {
    if (key.escape || input === "q") {
      onClose();
      return;
    }

    if (!branchDiff && changes.length > 0) {
      if (key.tab || key.rightArrow || input === "l") {
        setActiveIdx((prev: number) => (prev + 1) % changes.length);
      } else if (key.leftArrow || input === "h") {
        setActiveIdx((prev: number) => (prev - 1 + changes.length) % changes.length);
      }
    }
  });

  if (loading) {
    return (
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor={theme.colors.accent}
        paddingX={2}
        paddingY={1}
      >
        <Text color={theme.colors.accent}>Analyzing session diff...</Text>
      </Box>
    );
  }

  if (error) {
    return (
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor={theme.colors.toolError}
        paddingX={2}
        paddingY={1}
      >
        <Text bold color={theme.colors.toolError}>
          Diff Inspector
        </Text>
        <Text color={theme.colors.toolError}>Failed to compute the session diff: {error}</Text>
        <Box marginTop={1}>
          <Text dimColor>Press Esc to close.</Text>
        </Box>
      </Box>
    );
  }

  if (branchDiff) {
    const hasContent = Boolean(branchDiff.diff && branchDiff.diff.trim().length > 0);
    return (
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor={theme.colors.primary}
        paddingX={1}
        height={height}
        overflow="hidden"
      >
        <Box justifyContent="space-between" flexShrink={0} paddingX={1}>
          <Text bold color={theme.colors.primary}>
            Branch Diff ({branchDiff.branch}...HEAD)
          </Text>
          <Text dimColor>Esc / q: close</Text>
        </Box>
        <Box flexDirection="column" flexGrow={1} flexShrink={1} minHeight={0} marginY={1} overflow="hidden">
          {hasContent ? (
            <ColorizedDiff
              diff={branchDiff.diff}
              maxRows={Math.max(3, height - 6)}
              maxText={Math.max(20, termWidth - 10)}
            />
          ) : (
            <Text dimColor italic>
              No differences between branch &quot;{branchDiff.branch}&quot; and HEAD.
            </Text>
          )}
        </Box>
      </Box>
    );
  }

  if (changes.length === 0) {
    return (
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor={theme.colors.border}
        paddingX={2}
        paddingY={1}
      >
        <Text bold color={theme.colors.primary}>
          Diff Inspector
        </Text>
        <Text dimColor>No files modified in this session yet.</Text>
        <Box marginTop={1}>
          <Text dimColor>Press Esc to close.</Text>
        </Box>
      </Box>
    );
  }

  const activeFile = changes[activeIdx];
  const kindBadge =
    activeFile.kind === "created" ? "+ created" : activeFile.kind === "deleted" ? "− deleted" : "~ modified";

  // Sliding window over the file tabs so the strip can never wrap onto
  // multiple rows with many changed files.
  const tabCount = visibleTabs(termWidth);
  const start = Math.max(0, Math.min(activeIdx - Math.floor(tabCount / 2), changes.length - tabCount));
  const tabs = changes.slice(start, start + tabCount);
  const tabsWidth = tabCount * 28 - 4;

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={theme.colors.primary}
      paddingX={1}
      height={height}
      overflow="hidden"
    >
      <Box justifyContent="space-between" flexShrink={0} paddingX={1}>
        <Text bold color={theme.colors.primary}>
          Diff Inspector ({activeIdx + 1}/{changes.length} files)
        </Text>
        <Text dimColor>Tab / Left / Right: switch file · Esc: close</Text>
      </Box>

      {/* File Tabs */}
      <Box flexShrink={0} marginY={1} gap={1} width={tabsWidth} overflow="hidden">
        {start > 0 && <Text dimColor>…</Text>}
        {tabs.map((c: SessionFileChange) => {
          const i = changes.indexOf(c);
          return (
            <Text
              key={c.path}
              bold={i === activeIdx}
              color={i === activeIdx ? theme.colors.accent : undefined}
              dimColor={i !== activeIdx}
              inverse={i === activeIdx}
            >
              {" "}
              {i + 1}. {curtail(c.path, 24)}{" "}
            </Text>
          );
        })}
        {start + tabCount < changes.length && <Text dimColor>…</Text>}
      </Box>

      <Box justifyContent="space-between" flexShrink={0} paddingX={1}>
        <Text bold color={theme.colors.assistantText}>
          {curtail(activeFile.path, Math.max(20, termWidth - 20))}
        </Text>
        <Text dimColor>{kindBadge}</Text>
      </Box>

      {/* Diff Content — the only scrolling region; clipped, never overflowing
          the modal. The row budget matches what this modal actually has left. */}
      <Box flexDirection="column" flexGrow={1} flexShrink={1} minHeight={0} marginY={1} overflow="hidden">
        {activeFile.diff ? (
          <ColorizedDiff diff={activeFile.diff} maxRows={Math.max(3, height - 9)} maxText={Math.max(20, termWidth - 10)} />
        ) : (
          <Text dimColor italic>
            (Empty or deleted file)
          </Text>
        )}
      </Box>
    </Box>
  );
}
