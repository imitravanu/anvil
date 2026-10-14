import { Component, type ReactNode } from "react";
import { Box, Text } from "ink";
import { getErrorMessage } from "@anvil/core";
import { useTheme } from "../theme/theme.js";

interface BoundaryProps {
  children: ReactNode;
}

interface BoundaryState {
  error: string | null;
}

/** Shown in place of a transcript that failed to render. Colors come from the theme. */
function TranscriptFailure({ message }: { message: string }) {
  const theme = useTheme();
  return (
    <Box flexDirection="column" paddingX={1}>
      <Text color={theme.colors.toolError}>⚠ The transcript could not be rendered: {message}</Text>
      <Text color={theme.colors.textSecondary}>Send a new message to continue; earlier messages are kept.</Text>
    </Box>
  );
}

/**
 * Keeps one rendering failure in the transcript from killing the whole TUI.
 * Without it, a single bad message render unmounts the entire Ink tree and the
 * user loses the session view. The error is shown in place, so it is not silent.
 */
export class TranscriptBoundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { error: null };

  static getDerivedStateFromError(err: unknown): BoundaryState {
    return { error: getErrorMessage(err) };
  }

  render(): ReactNode {
    if (this.state.error !== null) {
      return <TranscriptFailure message={this.state.error} />;
    }
    return this.props.children;
  }
}
