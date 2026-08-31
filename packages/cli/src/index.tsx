#!/usr/bin/env node
import React from "react";
import { render } from "ink";
import { loadCredentials, createProviders, AgentSession, AUTO_APPROVE_BROKER } from "@anvil/core";
import { App } from "@anvil/tui";

const creds = loadCredentials();
const providers = createProviders(creds);

// Interactive TUI requires a real terminal (raw-mode keyboard input).
if (!process.stdin.isTTY) {
  console.error("Anvil needs an interactive terminal (stdin is not a TTY).");
  process.exit(1);
}

// Phase 3 default selection — Phase 4 replaces this with a real picker.
const providerId = process.env.ANVIL_PROVIDER || "gemini";
const model = process.env.ANVIL_MODEL || "gemini-3.6-flash";
const provider = providers[providerId as keyof typeof providers];

if (!provider?.isConfigured()) {
  console.error(`Provider "${providerId}" is not configured. Check ~/.anvil/credentials.json.`);
  process.exit(1);
}

const session = new AgentSession(provider, {
  systemPrompt: "You are Anvil, a terminal coding agent. Be concise.",
  model,
  maxTokens: 8192,
  projectRoot: process.cwd(),
  permissionBroker: AUTO_APPROVE_BROKER, // Phase 4 replaces this with an interactive broker
});

render(<App session={session} model={model} />);
