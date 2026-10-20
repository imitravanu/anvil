// Single source of the core version (leaf module — mcp/client.ts imports it
// without creating an import cycle through index.ts). docTruth pins this to
// BOTH the README release badge and the workspace package.json versions, so
// it can never drift from what ships.
export const CORE_VERSION = "1.4.0";

