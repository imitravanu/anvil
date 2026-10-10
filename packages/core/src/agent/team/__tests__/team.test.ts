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

  it("rejects an unknown strategy instead of falling through to pipeline (C9)", () => {
    // Typed as TeamSpec via a cast: the value must come from the runtime edge
    // (tool JSON), where a typo used to be coerced and silently ran pipeline.
    const bogus = { strategy: "fan-out", members: [{ id: "a", task: "x" }] } as unknown as TeamSpec;
    expect(validateTeamSpec(bogus)).toContain("unknown strategy");
  });

  it("rejects unusable totalIterations instead of starving or running away", () => {
    const two = [
      { id: "a", task: "x" },
      { id: "b", task: "y" },
    ];
    expect(
      validateTeamSpec({ strategy: "parallel", members: two, totalIterations: 0 })
    ).toContain("at least one share");
    expect(
      validateTeamSpec({ strategy: "parallel", members: two, totalIterations: -4 })
    ).toContain("at least one share");
    expect(
      validateTeamSpec({ strategy: "parallel", members: two, totalIterations: 2.5 })
    ).toContain("integer");
    expect(
      validateTeamSpec({ strategy: "parallel", members: two, totalIterations: 10_000 })
    ).toContain("runaway cap");
    expect(
      validateTeamSpec({ strategy: "parallel", members: two, totalIterations: 4 })
    ).toBeNull();
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

  // Takeover 2026-10-10: `review` used the parallel fan-out, so the reviewer
  // started at the same instant as the worker and "reviewed" a workspace whose
  // changes had not happened yet — the strategy silently did nothing it
  // promised. RED receipt: under the fan-out the reviewer is invoked while the
  // worker is still gated, and its task is the raw one.
  it("review runs the reviewer AFTER the worker, with the work in scope", async () => {
    let releaseWorker: () => void = () => {};
    const workerGate = new Promise<void>((resolve) => {
      releaseWorker = resolve;
    });
    let reviewerCalled = false;
    let reviewerTask = "";
    const deps = {
      projectRoot: "/tmp",
      runMember: async (spec: { id: string; task: string }): Promise<TeamMemberResult> => {
        if (spec.id === "worker") {
          await workerGate; // the work is "in progress" until the test releases it
          return { id: spec.id, report: "WORKER-REPORT", toolCalls: 2, inputTokens: 5, outputTokens: 3, aborted: false };
        }
        reviewerCalled = true;
        reviewerTask = spec.task;
        return { id: spec.id, report: "REVIEWER-REPORT", toolCalls: 1, inputTokens: 2, outputTokens: 1, aborted: false };
      },
    };
    const spec: TeamSpec = {
      strategy: "review",
      members: [
        { id: "worker", task: "implement the feature" },
        { id: "reviewer", task: "review the implementation" },
      ],
    };
    const teamPromise = runTeam(spec, deps, new AbortController().signal);
    // A macrotask is enough: under a concurrent fan-out the reviewer has been
    // invoked by now; sequentially it cannot have been.
    await new Promise((r) => setTimeout(r, 10));
    expect(reviewerCalled, "the reviewer must not start before the worker's work exists").toBe(false);
    releaseWorker();
    const result = await teamPromise;
    expect(result.members.map((m) => m.id)).toEqual(["worker", "reviewer"]);
    expect(reviewerTask).toContain("review the implementation");
    expect(reviewerTask, "the reviewer must see the worker's report").toContain("WORKER-REPORT");
  });

  it("rejects invalid specs", async () => {
    await expect(
      runTeam({ strategy: "parallel", members: [] }, fakeRunner({}), new AbortController().signal)
    ).rejects.toThrow("Invalid team spec");
  });
});
