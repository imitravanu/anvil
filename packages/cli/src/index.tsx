#!/usr/bin/env node
import React from "react";
import { render } from "ink";
import { loadCredentials, createProviders, AgentSession } from "@anvil/core";
import { App, TuiPermissionBroker } from "@anvil/tui";

const creds = loadCredentials();
const providers = createProviders(creds);
const broker = new TuiPermissionBroker();

// Interactive TUI requires a real terminal (raw-mode keyboard input).
if (!process.stdin.isTTY) {
  console.error("Anvil needs an interactive terminal (stdin is not a TTY).");
  process.exit(1);
}

// Initial selection — change models mid-session with /model.
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
  permissionBroker: broker, // interactive permission prompts (Phase 4)
});

render(<App session={session} broker={broker} providers={providers} model={model} />);
