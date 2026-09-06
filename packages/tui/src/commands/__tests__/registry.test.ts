import { describe, it, expect, vi } from "vitest";
import { COMMANDS, parseCommand, makeHandlers } from "../registry.js";
import type { CommandContext, CommandHandlerDeps } from "../types.js";

describe("TUI Command Registry & /goal", () => {
  it("parses /goal command and arguments", () => {
    const parsed = parseCommand("/goal add user auth");
    expect(parsed).toEqual({
      name: "goal",
      args: ["add", "user", "auth"],
    });
  });

  it("handles /goal in COMMANDS registry", () => {
    const goalCmd = COMMANDS.find((c) => c.name === "goal");
    expect(goalCmd).toBeDefined();

    const mockCtx: Partial<CommandContext> = {
      printSystemMessage: vi.fn(),
      launchGoal: vi.fn(),
    };

    // No objective passed
    goalCmd?.run([], mockCtx as CommandContext);
    expect(mockCtx.printSystemMessage).toHaveBeenCalledWith(
      expect.stringContaining("Usage: /goal <objective>")
    );
    expect(mockCtx.launchGoal).not.toHaveBeenCalled();

    // Objective passed
    goalCmd?.run(["refactor", "parser"], mockCtx as CommandContext);
    expect(mockCtx.launchGoal).toHaveBeenCalledWith("refactor parser");
  });

  it("launchGoal implementation rejects when session is busy", () => {
    const printSystemMessage = vi.fn();
    const send = vi.fn().mockResolvedValue(undefined);

    const deps: Partial<CommandHandlerDeps> = {
      isBusy: true,
      printSystemMessage,
      send,
    };

    const handlers = makeHandlers(deps as CommandHandlerDeps);
    handlers.launchGoal("do something");

    expect(printSystemMessage).toHaveBeenCalledWith(
      "Cannot launch a goal while a turn is in flight."
    );
    expect(send).not.toHaveBeenCalled();
  });

  it("launchGoal delegates to the real mission engine when idle", () => {
    const printSystemMessage = vi.fn();
    const send = vi.fn().mockResolvedValue(undefined);
    const launchGoal = vi.fn().mockResolvedValue(undefined);

    const deps: Partial<CommandHandlerDeps> = {
      isBusy: false,
      printSystemMessage,
      send,
      launchGoal,
    };

    const handlers = makeHandlers(deps as CommandHandlerDeps);
    handlers.launchGoal("build dashboard");

    expect(printSystemMessage).toHaveBeenCalledWith(
      expect.stringContaining('Autonomous Mission Initiated: "build dashboard"')
    );
    // The real GoalEngine mission runs over the live session — no fake
    // hardcoded deck, no synthetic "[Autonomous Goal Mode]" chat prompt.
    expect(launchGoal).toHaveBeenCalledWith("build dashboard");
    expect(send).not.toHaveBeenCalled();
  });
});
