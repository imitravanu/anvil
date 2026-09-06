import { useEffect, useState } from "react";
import { Box, Text, useInput, useStdout } from "ink";
import type { AgentSession, SessionFileChange } from "@anvil/core";
import { useTheme } from "../theme/theme.js";
import { ColorizedDiff } from "../diff/colorizeDiff.js";
import { curtail } from "../util/format.js";

export interface DiffModalProps {
  session: AgentSession;
  onClose: () => void;
}

export function DiffModal({ session, onClose }: DiffModalProps) {
  const theme = useTheme();
  const { stdout } = useStdout();
  const width = Math.max(40, (stdout?.columns ?? 80) - 4);
  const termRows = Math.max(10, (stdout?.rows ?? 24) - 6);

  const [changes, setChanges] = useState<SessionFileChange[]>([]);
  const [activeIdx, setActiveIdx] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    let active = true;
    void session.summarizeChanges().then((list) => {
      if (active) {
        setChanges(list);
        setLoading(false);
      }
    });
    return () => {
      active = false;
    };
  }, [session]);

  useInput((input, key) => {
    if (key.escape || input === "q") {
      onClose();
      return;
    }

    if (changes.length > 0) {
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

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={theme.colors.primary}
      paddingX={1}
      height={termRows}
    >
      <Box justifyContent="space-between" flexShrink={0} paddingX={1}>
        <Text bold color={theme.colors.primary}>
          Diff Inspector ({activeIdx + 1}/{changes.length} files)
        </Text>
        <Text dimColor>Tab / Left / Right: switch file · Esc: close</Text>
      </Box>

      {/* File Tabs */}
      <Box flexShrink={0} marginY={1} gap={1} flexWrap="wrap">
        {changes.map((c: SessionFileChange, i: number) => (
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
        ))}
      </Box>

      <Box justifyContent="space-between" flexShrink={0} paddingX={1}>
        <Text bold color={theme.colors.assistantText}>
          {activeFile.path}
        </Text>
        <Text dimColor>{kindBadge}</Text>
      </Box>

      {/* Diff Content */}
      <Box flexDirection="column" flexGrow={1} flexShrink={1} minHeight={0} marginY={1}>
        {activeFile.diff ? (
          <ColorizedDiff diff={activeFile.diff} />
        ) : (
          <Text dimColor italic>
            (Empty or deleted file)
          </Text>
        )}
      </Box>
    </Box>
  );
}
