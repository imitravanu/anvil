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

  it("parses and runs /diff with optional branch argument", () => {
    const parsedNoArg = parseCommand("/diff");
    expect(parsedNoArg).toEqual({ name: "diff", args: [] });

    const parsedBranch = parseCommand("/diff main");
    expect(parsedBranch).toEqual({ name: "diff", args: ["main"] });

    const diffCmd = COMMANDS.find((c) => c.name === "diff");
    expect(diffCmd).toBeDefined();

    const mockCtx: Partial<CommandContext> = {
      showDiff: vi.fn(),
    };

    diffCmd?.run([], mockCtx as CommandContext);
    expect(mockCtx.showDiff).toHaveBeenCalledWith(undefined);

    diffCmd?.run(["main"], mockCtx as CommandContext);
    expect(mockCtx.showDiff).toHaveBeenCalledWith("main");
  });

  it("parses and runs /pr command", () => {
    const parsed = parseCommand("/pr");
    expect(parsed).toEqual({ name: "pr", args: [] });

    const prCmd = COMMANDS.find((c) => c.name === "pr");
    expect(prCmd).toBeDefined();

    const mockCtx: Partial<CommandContext> = {
      createPr: vi.fn(),
    };

    prCmd?.run([], mockCtx as CommandContext);
    expect(mockCtx.createPr).toHaveBeenCalledTimes(1);
  });

  it("rejects /diff and /pr when session is busy", () => {
    const printSystemMessage = vi.fn();
    const deps: Partial<CommandHandlerDeps> = {
      isBusy: true,
      printSystemMessage,
    };
    const handlers = makeHandlers(deps as CommandHandlerDeps);

    handlers.showDiff("main");
    expect(printSystemMessage).toHaveBeenCalledWith("Cannot diff while a turn is in flight.");

    handlers.createPr();
    expect(printSystemMessage).toHaveBeenCalledWith("Cannot create PR while a turn is in flight.");
  });

  it("sessionRename updates session.title in memory", () => {
    const printSystemMessage = vi.fn();
    const mockSession = {
      id: "session-123",
      title: "Old Title",
    };
    const deps: Partial<CommandHandlerDeps> = {
      isBusy: false,
      session: mockSession as unknown as CommandHandlerDeps["session"],
      printSystemMessage,
    };
    const handlers = makeHandlers(deps as CommandHandlerDeps);
    handlers.sessionRename("New Title");

    expect(mockSession.title).toBe("New Title");
    expect(printSystemMessage).toHaveBeenCalledWith('Session renamed to "New Title".');
  });

  it("parses and runs /team /plugin /context commands", () => {
    expect(COMMANDS.find((c) => c.name === "team")).toBeDefined();
    expect(COMMANDS.find((c) => c.name === "plugin")).toBeDefined();
    expect(COMMANDS.find((c) => c.name === "context")).toBeDefined();

    const teamCmd = COMMANDS.find((c) => c.name === "team");
    const teamFn = vi.fn();
    teamCmd?.run(["status"], { team: teamFn } as unknown as CommandContext);
    expect(teamFn).toHaveBeenCalledWith(["status"]);

    const contextCmd = COMMANDS.find((c) => c.name === "context");
    const showContext = vi.fn();
    contextCmd?.run([], { showContext } as unknown as CommandContext);
    expect(showContext).toHaveBeenCalledTimes(1);
  });

  it("sessionRename rejects when session is busy", () => {
    const printSystemMessage = vi.fn();
    const mockSession = {
      id: "session-123",
      title: "Old Title",
    };
    const deps: Partial<CommandHandlerDeps> = {
      isBusy: true,
      session: mockSession as unknown as CommandHandlerDeps["session"],
      printSystemMessage,
    };
    const handlers = makeHandlers(deps as CommandHandlerDeps);
    handlers.sessionRename("New Title");

    expect(mockSession.title).toBe("Old Title");
    expect(printSystemMessage).toHaveBeenCalledWith("Cannot rename the session while a turn is in flight.");
  });
});
