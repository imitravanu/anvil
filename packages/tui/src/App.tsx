import React from "react";
import { Box, Text } from "ink";
import { CORE_VERSION } from "@anvil/core";

export function App() {
  return (
    <Box flexDirection="column" borderStyle="round" paddingX={2} paddingY={1}>
      <Text bold color="cyan">
        ANVIL
      </Text>
      <Text dimColor>core v{CORE_VERSION} — foundation phase</Text>
    </Box>
  );
}
