import { describe, expect, it } from "vitest";
import { runTeam, splitBudget, validateTeamSpec } from "../runner.js";
import type { TeamMemberResult, TeamSpec } from "../types.js";

function fakeRunner(reports: Record<string, string>) {
  return {
    projectRoot: "/tmp",
    runMember: async (spec: { id: string }): Promise<TeamMemberResult> => ({
      id: spec.id,
      report: reports[spec.id] ?? `did ${spec.id}`,
      toolCalls: 1,
      inputTokens: 10,
      outputTokens: 5,
      aborted: false,
    }),
  };
}

describe("validateTeamSpec", () => {
  it("rejects empty teams", () => {
    expect(validateTeamSpec({ strategy: "parallel", members: [] })).toContain("at least one");
  });

  it("rejects duplicate ids", () => {
    expect(
      validateTeamSpec({
        strategy: "parallel",
        members: [
          { id: "a", task: "one" },
          { id: "a", task: "two" },
        ],
      })
    ).toContain("duplicate");
  });

  it("review needs exactly two members", () => {
    expect(
      validateTeamSpec({ strategy: "review", members: [{ id: "a", task: "x" }] })
    ).toContain("exactly two");
  });

  it("pipeline needs at least two members", () => {
    expect(
      validateTeamSpec({ strategy: "pipeline", members: [{ id: "a", task: "x" }] })
    ).toContain("at least two");
  });
});

describe("splitBudget", () => {
  it("splits evenly with remainder to early members", () => {
    const spec: TeamSpec = {
      strategy: "parallel",
      totalIterations: 10,
      members: [
        { id: "a", task: "x" },
        { id: "b", task: "y" },
        { id: "c", task: "z" },
      ],
    };
    expect(splitBudget(spec)).toEqual([4, 3, 3]);
  });
});

describe("runTeam", () => {
  it("runs parallel members and merges reports", async () => {
    const spec: TeamSpec = {
      strategy: "parallel",
      members: [
        { id: "feature", task: "implement" },
        { id: "tests", task: "write tests" },
      ],
    };
    const result = await runTeam(spec, fakeRunner({ feature: "built", tests: "covered" }), new AbortController().signal);
    expect(result.members).toHaveLength(2);
    expect(result.totalToolCalls).toBe(2);
    expect(result.combinedReport).toContain("## feature");
    expect(result.combinedReport).toContain("## tests");
  });

  it("pipeline hands prior report to the next member", async () => {
    const seen: string[] = [];
    const deps = {
      projectRoot: "/tmp",
      runMember: async (spec: { id: string; task: string }): Promise<TeamMemberResult> => {
        seen.push(spec.task);
        return { id: spec.id, report: `out-${spec.id}`, toolCalls: 1, inputTokens: 1, outputTokens: 1, aborted: false };
      },
    };
    const spec: TeamSpec = {
      strategy: "pipeline",
      members: [
        { id: "a", task: "step one" },
        { id: "b", task: "step two" },
      ],
    };
    await runTeam(spec, deps, new AbortController().signal);
    expect(seen[1]).toContain("out-a");
  });

  it("member failure becomes failureReason, not a throw", async () => {
    const deps = {
      projectRoot: "/tmp",
      runMember: async (): Promise<TeamMemberResult> => {
        throw new Error("boom");
      },
    };
    const spec: TeamSpec = {
      strategy: "parallel",
      members: [{ id: "a", task: "x" }],
    };
    const result = await runTeam(spec, deps, new AbortController().signal);
    expect(result.members[0].failureReason).toBe("boom");
  });

  it("rejects invalid specs", async () => {
    await expect(
      runTeam({ strategy: "parallel", members: [] }, fakeRunner({}), new AbortController().signal)
    ).rejects.toThrow("Invalid team spec");
  });
});
