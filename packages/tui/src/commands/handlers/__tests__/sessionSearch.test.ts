import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { saveSession, SESSION_SEARCH_MIN_QUERY_CHARS, type StoredSession } from "@anvil/core";
import { handleSessionSearch } from "../session.js";
import { COMMANDS } from "../../registry.js";
import type { CommandContext, CommandHandlerDeps } from "../../types.js";

let home: string;
let originalHome: string | undefined;

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "anvil-sessionsearch-"));
  originalHome = process.env.ANVIL_HOME;
  process.env.ANVIL_HOME = home;
});

afterEach(() => {
  if (originalHome === undefined) delete process.env.ANVIL_HOME;
  else process.env.ANVIL_HOME = originalHome;
  fs.rmSync(home, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function seed(id: string, title: string, updatedAt: string, lines: string[]): void {
  const stored: StoredSession = {
    metadata: {
      id,
      title,
      providerId: "anthropic",
      model: "claude-opus-5",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt,
    },
    history: lines.map((line) => ({ role: "user" as const, content: [{ type: "text" as const, text: line }] })),
  };
  saveSession(stored);
}

function deps(printSystemMessage: (text: string) => void): CommandHandlerDeps {
  return { printSystemMessage } as unknown as CommandHandlerDeps;
}

describe("handleSessionSearch", () => {
  it("prints usage for a missing query", () => {
    const print = vi.fn();
    handleSessionSearch(deps(print), "   ");

    expect(print).toHaveBeenCalledWith(expect.stringContaining("Usage: /session search"));
  });

  it("explains the minimum query length instead of silently showing nothing", () => {
    const print = vi.fn();
    handleSessionSearch(deps(print), "a".repeat(SESSION_SEARCH_MIN_QUERY_CHARS - 1));

    expect(print).toHaveBeenCalledWith(expect.stringContaining("at least"));
  });

  it("says so when nothing matches", () => {
    seed("s1", "Unrelated", "2026-01-02T00:00:00.000Z", ["something else"]);
    const print = vi.fn();
    handleSessionSearch(deps(print), "needle");

    expect(print).toHaveBeenCalledWith(expect.stringContaining("No saved session mentions"));
  });

  it("lists the id prefix, title, and a role-tagged snippet for a hit", () => {
    seed("abcdef1234567890", "Retry budget", "2026-01-02T00:00:00.000Z", [
      "lower the retry budget please",
    ]);
    const print = vi.fn();
    handleSessionSearch(deps(print), "retry budget");

    const output = print.mock.calls[0]![0] as string;
    // The short id is what the user pastes into `/session resume <id>`.
    expect(output).toContain("abcdef12");
    expect(output).toContain("Retry budget");
    expect(output).toContain("message(s)");
    expect(output).toContain("user: ");
  });
});

describe("/session dispatch", () => {
  const sessionCommand = COMMANDS.find((c) => c.name === "session");

  it("joins a multi-word search query instead of truncating it", () => {
    const sessionSearch = vi.fn();
    const ctx = { sessionSearch, printSystemMessage: vi.fn() } as unknown as CommandContext;

    sessionCommand!.run(["search", "retry", "budget"], ctx);

    expect(sessionSearch).toHaveBeenCalledWith("retry budget");
  });

  it("advertises search in the unknown-subcommand hint", () => {
    const printSystemMessage = vi.fn();
    const ctx = { printSystemMessage } as unknown as CommandContext;

    sessionCommand!.run(["bogus"], ctx);

    // The hint lists bare subcommand forms (`search <text>`), matching how the
    // other subcommands appear in the same line.
    expect(printSystemMessage).toHaveBeenCalledWith(expect.stringContaining("search <text>"));
  });
});
