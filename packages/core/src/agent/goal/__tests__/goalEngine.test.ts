import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { GoalEngine, accumulateGoalOutcome, isSatisfiedVerdict, parseMilestones } from "../goalEngine.js";
import { FakeProvider, ScriptEntry, stalledStream } from "../../__tests__/fakeProvider.js";
import { StreamEvent } from "../../../providers/types.js";
import { AgentSession } from "../../session.js";
import { DEFAULT_MAX_TOKENS } from "../../../config/constants.js";

const textTurn = (text: string): StreamEvent[] => [
  { type: "text_delta", text },
  { type: "turn_end", stopReason: "end_turn" },
];

// Phase 22.5 — the review verdict rule, exercised directly. A hedged YES is the
// failure mode that matters: it must not mark a milestone complete.
describe("isSatisfiedVerdict (Phase 22.5)", () => {
  it("accepts any response that starts with YES", () => {
    for (const verdict of ["YES", "YES.", "YES — criteria met", "YES\n- all good", "yes — done"]) {
      expect(isSatisfiedVerdict(verdict), verdict).toBe(true);
    }
  });

  it("rejects a hedged yes instead of reading it as satisfied", () => {
    for (const verdict of [
      "YES, but the criteria were not met",
      "YES, however only the first file was touched",
      "Yes, although the tests still fail",
      "YES, unfortunately only partially complete",
      "YES, except the report is missing",
      // C2/AUDIT-2026-09-30: the engine's own prompt teaches the "YES — …"
      // separator, which the comma-only rule read as satisfaction.
      "YES — however the criteria were not met",
      "YES—but only partially",
      "YES. Although nothing was verified",
    ]) {
      expect(isSatisfiedVerdict(verdict), verdict).toBe(false);
    }
  });

  it("rejects a YES that goes on to state a defect (2026-10-14 audit: 8 of 14 accepted)", () => {
    // Each was accepted by the old word-list rule. The mission uses this verdict
    // to mark a milestone COMPLETE, so a negative statement must never pass.
    for (const verdict of [
      "YES. The tests fail.",
      "YES. Criteria not met.",
      "YES — not all criteria are met",
      "YES. I did not verify the tests.",
      "YES. Not done.",
      "YES. Missing the export.",
      "YES. Yet tests fail.",
      "YES - still broken",
      "YES. Fails.",
      "YES. Incomplete.",
    ]) {
      expect(isSatisfiedVerdict(verdict), verdict).toBe(false);
    }
  });

  it("still accepts a clean YES that merely mentions passing tests or the criteria", () => {
    for (const verdict of [
      "YES",
      "YES — all criteria met and tests pass",
      "YES. Tests pass and the export is present.",
      "YES, the criteria are satisfied.",
    ]) {
      expect(isSatisfiedVerdict(verdict), verdict).toBe(true);
    }
  });

  it("rejects a plain no, and tolerates surrounding whitespace", () => {
    expect(isSatisfiedVerdict("NO — criteria not met")).toBe(false);
    expect(isSatisfiedVerdict("  YES — done  ")).toBe(true);
  });
});

// The event→outcome rule used to live twice (GoalEngine's turn runner and the
// TUI's live runner) and the copies diverged: the TUI never counted
// `verification_gave_up` as a failure, so a milestone could complete on
// still-failing tests, and it let an early failure stick past a successful
// repair. One reducer now owns the rule for both callers.
describe("accumulateGoalOutcome (single owner of the event→outcome rule)", () => {
  const base = () => ({
    text: "",
    errored: false,
    verificationFailed: false,
    permissionDenied: false,
    cancelled: false,
  });

  it("treats verification_gave_up as a failure — not a pass", () => {
    const outcome = base();
    accumulateGoalOutcome(outcome, { type: "verification_gave_up", command: "npm test" });
    expect(outcome.verificationFailed).toBe(true);
  });

  it("lets the LAST verification verdict win, so a successful repair clears a failure", () => {
    const outcome = base();
    accumulateGoalOutcome(outcome, { type: "verification_result", passed: false, summary: "failed" });
    expect(outcome.verificationFailed).toBe(true);
    accumulateGoalOutcome(outcome, { type: "verification_result", passed: true, summary: "passed" });
    expect(outcome.verificationFailed).toBe(false);
  });

  it("accumulates text and the terminal signals", () => {
    const outcome = base();
    accumulateGoalOutcome(outcome, { type: "text_delta", text: "a" });
    accumulateGoalOutcome(outcome, { type: "text_delta", text: "b" });
    accumulateGoalOutcome(outcome, { type: "tool_permission_denied", id: "t1", name: "write_file" });
    accumulateGoalOutcome(outcome, { type: "error", message: "boom" });
    accumulateGoalOutcome(outcome, { type: "cancelled" });
    expect(outcome).toEqual({
      text: "ab",
      errored: true,
      verificationFailed: false,
      permissionDenied: true,
      cancelled: true,
    });
  });
});

describe("Autonomous Goal Engine", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "anvil-goal-test-"));
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  describe("parseMilestones", () => {
    it("parses valid JSON array of milestones", () => {
      const raw = `Here is the plan:
\`\`\`json
[
  { "id": "m1", "title": "Inspect code", "criteria": "Find entry point" },
  { "id": "m2", "title": "Build feature", "criteria": "Export new function" }
]
\`\`\`
Let's begin.`;

      const milestones = parseMilestones(raw, "Build feature");
      expect(milestones).toHaveLength(2);
      expect(milestones[0].id).toBe("m1");
      expect(milestones[0].title).toBe("Inspect code");
      expect(milestones[0].criteria).toBe("Find entry point");
      expect(milestones[0].status).toBe("pending");
      expect(milestones[1].id).toBe("m2");
    });

    it("falls back to the 3-phase plan for broad goals without JSON", () => {
      const raw = "I will work directly on this problem without JSON.";
      const milestones = parseMilestones(raw, "Refactor the auth module and migrate the storage layer");

      expect(milestones).toHaveLength(3);
      expect(milestones[0].title).toContain("Reconnaissance");
      expect(milestones[1].title).toContain("Core Implementation");
      expect(milestones[2].title).toContain("Verification");
      expect(milestones.every((m) => m.status === "pending")).toBe(true);
    });

    it("scales the fallback down to ONE milestone for short single-action goals", () => {
      const milestones = parseMilestones("No JSON here.", "Fix bug");
      expect(milestones).toHaveLength(1);
      expect(milestones[0].criteria).toBe("Fix bug");
    });

    it("drops malformed rows instead of fabricating milestones from them", () => {
      // The old mapping turned `null`, `{}` and non-string fields into
      // executable milestones with invented titles/criteria. A row with no
      // usable title is not actionable and must not run.
      const raw = JSON.stringify([
        { id: "1", title: "Real work", criteria: "do the real work" },
        null,
        { id: "2" },
        { id: "3", title: 42, criteria: "not a title" },
        { id: "4", title: "Missing criteria" },
      ]);
      const milestones = parseMilestones(raw, "Broad goal with several verbs: fix and polish");
      expect(milestones).toHaveLength(2);
      expect(milestones[0].title).toBe("Real work");
      expect(milestones[1].title).toBe("Missing criteria");
      // Criteria fall back to the title, never to an invented generic string.
      expect(milestones[1].criteria).toBe("Missing criteria");
    });

    it("makes milestone ids unique — the deck updates rows by id", () => {
      const raw = JSON.stringify([
        { id: "dup", title: "First", criteria: "a" },
        { id: "dup", title: "Second", criteria: "b" },
      ]);
      const milestones = parseMilestones(raw, "Fix bug");
      expect(milestones.map((m) => m.id)).toEqual(["dup", "dup-2"]);
    });

    it("extracts the plan when a second object array follows it in prose", () => {
      // The greedy regex matched from the first `[` to the LAST `}]` in the
      // reply, merging the trailing example into the plan blob; JSON.parse then
      // failed and the deterministic fallback silently replaced the REAL plan.
      const raw =
        '[{"id":"1","title":"Real plan","criteria":"do it"}] Another example: [{"id":"9","title":"Example","criteria":"e"}]';
      const milestones = parseMilestones(raw, "Broad goal with several verbs: fix and polish");
      expect(milestones).toHaveLength(1);
      expect(milestones[0].title).toBe("Real plan");
    });

    it("caps a runaway milestone list and keeps the first entries", () => {
      const raw = JSON.stringify(
        Array.from({ length: 12 }, (_, i) => ({ id: String(i + 1), title: `M${i + 1}`, criteria: `c${i}` }))
      );
      const milestones = parseMilestones(raw, "Fix bug");
      expect(milestones).toHaveLength(8);
      expect(milestones[0].title).toBe("M1");
      expect(milestones[7].title).toBe("M8");
    });
  });

  describe("GoalEngine.run", () => {
    function collect(engine: GoalEngine, goal: string) {
      const events: any[] = [];
      const iterator = engine.run(goal);
      return (async () => {
        let result: any;
        while (true) {
          const next = await iterator.next();
          if (next.done) {
            result = next.value;
            break;
          }
          events.push(next.value);
        }
        return { events, result };
      })();
    }

    it("executes the full lifecycle and only completes milestones that pass self-review", async () => {
      fs.writeFileSync(
        path.join(tmpDir, "package.json"),
        JSON.stringify({ name: "goal-test-repo", scripts: { test: "exit 0" } })
      );

      const planResponse: StreamEvent[] = [
        {
          type: "text_delta",
          text: JSON.stringify([
            { id: "1", title: "Milestone 1: Read Config", criteria: "Read package.json" },
            { id: "2", title: "Milestone 2: Add Config Item", criteria: "Update package.json" },
          ]),
        },
        { type: "turn_end", stopReason: "end_turn" },
      ];

      const script: ScriptEntry[] = [
        planResponse,
        textTurn("Milestone 1 satisfied: read configuration successfully."),
        textTurn("YES — package.json was read and the report matches the criteria."),
        textTurn("Milestone 2 satisfied: updated config."),
        textTurn("YES — the config item was added and verified."),
        textTurn("Adversarial critique: No regressions detected. All criteria satisfied."),
      ];

      const provider = new FakeProvider(script);
      const engine = new GoalEngine({
        provider,
        model: "fake-model",
        projectRoot: tmpDir,
        permissionBroker: { async requestPermission() { return true; } },
        autoVerify: false,
      });

      const { events, result } = await collect(engine, "Implement configuration update");

      const eventTypes = events.map((e) => e.type);
      expect(eventTypes).toContain("awareness_ready");
      expect(eventTypes).toContain("plan_decomposed");
      expect(eventTypes).toContain("milestone_started");
      expect(eventTypes).toContain("milestone_completed");
      expect(eventTypes).toContain("critique_started");
      expect(eventTypes).toContain("critique_result");
      expect(eventTypes).toContain("goal_completed");

      expect(result).toBeDefined();
      expect(result.goal).toBe("Implement configuration update");
      expect(result.success).toBe(true);
      expect(result.milestones).toHaveLength(2);
      expect(result.milestones[0].status).toBe("completed");
      expect(result.milestones[1].status).toBe("completed");
      expect(result.criticVerdict).toContain("Adversarial critique");
      expect(result.totalTurns).toBeGreaterThanOrEqual(3);
      // The shared chat budget, not the old hardcoded 4,096: reasoning models
      // bill deliberation inside the output ceiling, so the half-budget
      // starved goal turns (Probe K).
      expect(provider.calls[0].maxTokens).toBe(DEFAULT_MAX_TOKENS);
    });

    it("marks a milestone FAILED when self-review rejects it, and the run is not a success", async () => {
      const planResponse: StreamEvent[] = [
        {
          type: "text_delta",
          text: JSON.stringify([
            { id: "1", title: "Only milestone", criteria: "Do the thing" },
          ]),
        },
        { type: "turn_end", stopReason: "end_turn" },
      ];

      const script: ScriptEntry[] = [
        planResponse,
        textTurn("I believe the milestone is done."),
        textTurn("NO — the criteria were not met; the file was never written."),
        textTurn("Adversarial critique: milestone failed, goal not fulfilled."),
      ];

      const provider = new FakeProvider(script);
      const engine = new GoalEngine({
        provider,
        model: "fake-model",
        projectRoot: tmpDir,
        permissionBroker: { async requestPermission() { return true; } },
        autoVerify: false,
      });

      const { events, result } = await collect(engine, "Broad goal with two verbs: fix and polish things");

      expect(events.map((e) => e.type)).toContain("milestone_failed");
      expect(result.milestones[0].status).toBe("failed");
      expect(result.success).toBe(false);
    });

    it("keeps unattempted milestones pending when the turn budget runs out", async () => {
      fs.writeFileSync(
        path.join(tmpDir, "package.json"),
        JSON.stringify({ name: "goal-test-repo" })
      );

      const planResponse: StreamEvent[] = [
        {
          type: "text_delta",
          text: JSON.stringify([
            { id: "1", title: "Milestone 1", criteria: "Step 1" },
            { id: "2", title: "Milestone 2", criteria: "Step 2" },
            { id: "3", title: "Milestone 3", criteria: "Step 3" },
          ]),
        },
        { type: "turn_end", stopReason: "end_turn" },
      ];

      // With maxTurns = 2: turn 1 = planning, turn 2 = M1 execution,
      // turn 3 = M1 review (allowed to finish), then the budget stops M2/M3.
      const script: ScriptEntry[] = [
        planResponse,
        textTurn("Finished M1"),
        textTurn("YES — step 1 done."),
        textTurn("Critique complete"),
      ];

      const provider = new FakeProvider(script);
      const engine = new GoalEngine({
        provider,
        model: "fake-model",
        projectRoot: tmpDir,
        permissionBroker: { async requestPermission() { return true; } },
        maxTurns: 2,
        autoVerify: false,
      });

      const { events, result } = await collect(engine, "Constrained Goal");

      expect(result.milestones[0].status).toBe("completed");
      expect(result.milestones[1].status).toBe("pending");
      expect(result.milestones[2].status).toBe("pending");
      expect(result.success).toBe(false); // Not all completed
      expect(events.map((e) => e.type)).not.toContain("milestone_failed");
    });

    it("fails fast with goal_failed when a mutating tool is permission-denied", async () => {
      const script: ScriptEntry[] = [
        textTurn(JSON.stringify([{ id: "1", title: "Write it", criteria: "File exists" }])),
        // Real tool-call stream: the session routes it through the broker,
        // which denies → the session emits tool_permission_denied.
        [
          { type: "tool_call_start", id: "t1", name: "write_file" },
          {
            type: "tool_call_end",
            id: "t1",
            name: "write_file",
            input: { path: "out.txt", content: "hi" },
          },
          { type: "turn_end", stopReason: "tool_use" },
        ],
      ];

      const provider = new FakeProvider(script);
      const engine = new GoalEngine({
        provider,
        model: "fake-model",
        projectRoot: tmpDir,
        permissionBroker: { async requestPermission() { return false; } },
        autoVerify: false,
      });

      const { events, result } = await collect(engine, "Create the widget file");

      const types = events.map((e) => e.type);
      expect(types).toContain("milestone_failed");
      expect(types).toContain("goal_failed");
      expect(String(events.find((e) => e.type === "goal_failed")?.error)).toContain("-y");
      expect(result.success).toBe(false);
      expect(result.milestones[0].status).toBe("failed");
    });

    it("recovers a non-empty critic verdict when the critique turn is silent", async () => {
      const planResponse: StreamEvent[] = [
        {
          type: "text_delta",
          text: JSON.stringify([{ id: "1", title: "Only", criteria: "Do it" }]),
        },
        { type: "turn_end", stopReason: "end_turn" },
      ];

      const silentTurn = (extra: StreamEvent[] = []): StreamEvent[] => [
        ...extra,
        { type: "turn_end", stopReason: "end_turn" },
      ];

      // Milestone turn has prose; its review says YES; the final critique is
      // SILENT (no text_delta), the re-ask answers.
      const script: ScriptEntry[] = [
        planResponse,
        textTurn("Did the thing."),
        textTurn("YES — done."),
        silentTurn(),
        textTurn("Final verdict: mission accomplished."),
      ];

      const provider = new FakeProvider(script);
      const engine = new GoalEngine({
        provider,
        model: "fake-model",
        projectRoot: tmpDir,
        permissionBroker: { async requestPermission() { return true; } },
        autoVerify: false,
      });

      const { result } = await collect(engine, "Create the widget file");
      expect(result.criticVerdict).toContain("mission accomplished");
    });

    it("commits ONLY session-touched files per milestone, never stray secrets", async () => {
      const { execSync } = await import("node:child_process");
      execSync("git init", { cwd: tmpDir });
      execSync("git config user.name 'Test Runner'", { cwd: tmpDir });
      execSync("git config user.email 'test@example.com'", { cwd: tmpDir });

      fs.writeFileSync(path.join(tmpDir, "initial.txt"), "hello");
      execSync("git add -A && git commit -m 'initial'", { cwd: tmpDir });

      // An untracked secret the mission never touches — the old `git add -A`
      // swept it into history; the scoped commit must leave it alone.
      fs.writeFileSync(path.join(tmpDir, "untracked-secret.env"), "API_KEY=super-secret");

      const planResponse: StreamEvent[] = [
        {
          type: "text_delta",
          text: JSON.stringify([{ id: "1", title: "Add feature file", criteria: "feature.txt exists" }]),
        },
        { type: "turn_end", stopReason: "end_turn" },
      ];

      // The milestone turn REALLY writes feature.txt through the session, so
      // the auto-commit has a session-touched path to stage.
      const writeTurn: StreamEvent[] = [
        { type: "tool_call_start", id: "t1", name: "write_file" },
        {
          type: "tool_call_end",
          id: "t1",
          name: "write_file",
          input: { path: "feature.txt", content: "new feature content" },
        },
        { type: "turn_end", stopReason: "tool_use" },
      ];

      const script: ScriptEntry[] = [
        planResponse,
        writeTurn,
        textTurn("Milestone 1 completed: created feature.txt"),
        textTurn("YES — feature file added."),
        textTurn("Critic: LGTM"),
      ];

      const provider = new FakeProvider(script);
      const engine = new GoalEngine({
        provider,
        model: "fake-model",
        projectRoot: tmpDir,
        permissionBroker: { async requestPermission() { return true; } },
        autoVerify: false,
        autoCommit: true,
      });

      const { events, result } = await collect(engine, "Add feature file");
      expect(result.success).toBe(true);

      const log = execSync("git log -n 1 --pretty=format:%s", { cwd: tmpDir }).toString();
      expect(log).toBe("anvil(goal): milestone 1 — Add feature file");

      const committedFiles = execSync("git show --name-only --pretty=format:", { cwd: tmpDir })
        .toString()
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);
      expect(committedFiles).toEqual(["feature.txt"]);

      // The secret is still untracked in the worktree — never committed.
      const status = execSync("git status --porcelain", { cwd: tmpDir }).toString();
      expect(status).toContain("?? untracked-secret.env");

      const commitProgress = events.find(
        (e: any) => e.type === "milestone_progress" && e.detail.startsWith("Committed milestone 1:")
      );
      expect(commitProgress).toBeDefined();
    });

    it("skips the auto-commit when the mission touched no files", async () => {
      const { execSync } = await import("node:child_process");
      execSync("git init", { cwd: tmpDir });
      execSync("git config user.name 'Test Runner'", { cwd: tmpDir });
      execSync("git config user.email 'test@example.com'", { cwd: tmpDir });

      fs.writeFileSync(path.join(tmpDir, "initial.txt"), "hello");
      execSync("git add -A && git commit -m 'initial'", { cwd: tmpDir });

      const planResponse: StreamEvent[] = [
        {
          type: "text_delta",
          text: JSON.stringify([{ id: "1", title: "Only", criteria: "Do it" }]),
        },
        { type: "turn_end", stopReason: "end_turn" },
      ];

      const script: ScriptEntry[] = [
        planResponse,
        textTurn("Done, no files needed."),
        textTurn("YES — done."),
        textTurn("Critic: LGTM"),
      ];

      const provider = new FakeProvider(script);
      const engine = new GoalEngine({
        provider,
        model: "fake-model",
        projectRoot: tmpDir,
        permissionBroker: { async requestPermission() { return true; } },
        autoVerify: false,
        autoCommit: true,
      });

      const { events, result } = await collect(engine, "Think only");
      expect(result.success).toBe(true);

      // No new commit: still exactly one commit in history.
      const count = execSync("git rev-list --count HEAD", { cwd: tmpDir }).toString().trim();
      expect(count).toBe("1");

      const skipped = events.find(
        (e: any) => e.type === "milestone_progress" && e.detail.includes("Skipped auto-commit")
      );
      expect(skipped).toBeDefined();
    });
    it("reports the summarizeChanges failure instead of blaming the session (C16)", async () => {
      const { execSync } = await import("node:child_process");
      execSync("git init", { cwd: tmpDir });
      execSync("git config user.name 'Test Runner'", { cwd: tmpDir });
      execSync("git config user.email 'test@example.com'", { cwd: tmpDir });
      fs.writeFileSync(path.join(tmpDir, "initial.txt"), "hello");
      execSync("git add -A && git commit -m 'initial'", { cwd: tmpDir });

      const planResponse: StreamEvent[] = [
        {
          type: "text_delta",
          text: JSON.stringify([{ id: "1", title: "Only", criteria: "Do it" }]),
        },
        { type: "turn_end", stopReason: "end_turn" },
      ];
      const provider = new FakeProvider([
        planResponse,
        textTurn("Done, no files needed."),
        textTurn("YES — done."),
        textTurn("Critic: LGTM"),
      ]);
      const engine = new GoalEngine({
        provider,
        model: "fake-model",
        projectRoot: tmpDir,
        permissionBroker: { async requestPermission() { return true; } },
        autoVerify: false,
        autoCommit: true,
      });

      // The change-summary (the /diff baseline) throws: that is NOT the same as
      // "the session touched no files". The skip notice must name the real cause.
      const spy = vi
        .spyOn(AgentSession.prototype, "summarizeChanges")
        .mockRejectedValueOnce(new Error("git diff exploded"));
      try {
        const { events } = await collect(engine, "Think only");
        const skipped = events.find(
          (e: any) => e.type === "milestone_progress" && e.detail.includes("Skipped auto-commit")
        );
        expect(skipped).toBeDefined();
        expect((skipped as { detail: string }).detail).toContain("could not summarize session changes");
        expect((skipped as { detail: string }).detail).toContain("git diff exploded");
      } finally {
        spy.mockRestore();
      }
    });

    /** Wait until the provider has begun its Nth streamed turn. */
    async function waitForTurn(provider: FakeProvider, n: number): Promise<void> {
      const deadline = Date.now() + 3000;
      while (provider.calls.length < n && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      expect(provider.calls.length).toBeGreaterThanOrEqual(n);
    }

    it("aborts the mission when the PLANNING turn is cancelled", async () => {
      const provider = new FakeProvider([
        (req) => stalledStream(req.signal ?? new AbortController().signal, { type: "text_delta", text: "thinking..." }),
      ]);
      const engine = new GoalEngine({
        provider,
        model: "fake-model",
        projectRoot: tmpDir,
        permissionBroker: { async requestPermission() { return true; } },
        autoVerify: false,
      });

      const runPromise = collect(engine, "Ambiguous goal");
      await waitForTurn(provider, 1);
      engine.cancel();
      const { events, result } = await runPromise;

      const failed = events.find((e) => e.type === "goal_failed");
      expect(failed).toBeDefined();
      expect(String(failed?.error)).toContain("cancelled");
      expect((failed as { cancelled?: boolean } | undefined)?.cancelled).toBe(true);
      expect(result.summary).toBe("Mission cancelled during planning.");
      expect(result.totalTurns).toBe(1);
      expect(result.milestones).toEqual([]);
      expect(result.success).toBe(false);
      expect(result.cancelled).toBe(true);
    });

    it("aborts the mission when a MILESTONE turn is cancelled", async () => {
      const planResponse: StreamEvent[] = [
        {
          type: "text_delta",
          text: JSON.stringify([{ id: "1", title: "Only", criteria: "Do it" }]),
        },
        { type: "turn_end", stopReason: "end_turn" },
      ];
      const provider = new FakeProvider([
        planResponse,
        (req) => stalledStream(req.signal ?? new AbortController().signal, { type: "text_delta", text: "working..." }),
      ]);
      const engine = new GoalEngine({
        provider,
        model: "fake-model",
        projectRoot: tmpDir,
        permissionBroker: { async requestPermission() { return true; } },
        autoVerify: false,
      });

      const runPromise = collect(engine, "Think only");
      await waitForTurn(provider, 2);
      engine.cancel();
      const { events, result } = await runPromise;

      expect(events.map((e) => e.type)).toContain("milestone_started");
      expect(events.map((e) => e.type)).toContain("goal_failed");
      expect(result.summary).toBe("Mission cancelled during milestone 1.");
      expect(result.milestones[0].status).toBe("in_progress");
      expect(result.success).toBe(false);
      expect(result.cancelled).toBe(true);
    });

    it("aborts the mission when the REVIEW turn is cancelled", async () => {
      const planResponse: StreamEvent[] = [
        {
          type: "text_delta",
          text: JSON.stringify([{ id: "1", title: "Only", criteria: "Do it" }]),
        },
        { type: "turn_end", stopReason: "end_turn" },
      ];
      const provider = new FakeProvider([
        planResponse,
        textTurn("Milestone 1 done."),
        (req) => stalledStream(req.signal ?? new AbortController().signal, { type: "text_delta", text: "reviewing..." }),
      ]);
      const engine = new GoalEngine({
        provider,
        model: "fake-model",
        projectRoot: tmpDir,
        permissionBroker: { async requestPermission() { return true; } },
        autoVerify: false,
      });

      const runPromise = collect(engine, "Think only");
      await waitForTurn(provider, 3);
      engine.cancel();
      const { events, result } = await runPromise;

      expect(events.map((e) => e.type)).toContain("goal_failed");
      expect(result.summary).toBe("Mission cancelled during milestone 1 review.");
      expect(result.success).toBe(false);
      expect(result.cancelled).toBe(true);
    });

    it("returns a CANCELLED result when the mission is cancelled during the final critique", async () => {
      // C3/AUDIT-2026-09-30: cancellation during the critique used to be
      // cosmetic — the debrief still ran and a mission whose milestones had
      // completed reported success:true, so Ctrl+C during the last turn could
      // exit 0. The cancelled state must survive into the result (exit 130).
      const planResponse: StreamEvent[] = [
        {
          type: "text_delta",
          text: JSON.stringify([{ id: "1", title: "Only", criteria: "Do it" }]),
        },
        { type: "turn_end", stopReason: "end_turn" },
      ];
      const provider = new FakeProvider([
        planResponse,
        textTurn("Milestone 1 done."),
        textTurn("YES — criteria met."),
        (req) => stalledStream(req.signal ?? new AbortController().signal, { type: "text_delta", text: "critiquing..." }),
      ]);
      const engine = new GoalEngine({
        provider,
        model: "fake-model",
        projectRoot: tmpDir,
        permissionBroker: { async requestPermission() { return true; } },
        autoVerify: false,
      });

      const runPromise = collect(engine, "Think only");
      await waitForTurn(provider, 4);
      engine.cancel();
      const { events, result } = await runPromise;

      expect(result.cancelled).toBe(true);
      expect(result.success).toBe(false);
      expect(result.summary).toContain("cancelled");
      const completed = events.find((e) => e.type === "goal_completed");
      expect(completed).toBeDefined();
      expect((completed as { result: { cancelled?: boolean; success: boolean } }).result.cancelled).toBe(true);
      expect((completed as { result: { cancelled?: boolean; success: boolean } }).result.success).toBe(false);
    });

    it("aborts the mission when the planning turn ERRORS", async () => {
      const provider = new FakeProvider([
        [
          { type: "error", message: "provider exploded", isRetryable: false },
          { type: "turn_end", stopReason: "error" },
        ],
      ]);
      const engine = new GoalEngine({
        provider,
        model: "fake-model",
        projectRoot: tmpDir,
        permissionBroker: { async requestPermission() { return true; } },
        autoVerify: false,
      });

      const { events, result } = await collect(engine, "Anything");
      const failed = events.find((e) => e.type === "goal_failed");
      expect(String(failed?.error)).toContain("Planning turn failed");
      expect(result.summary).toBe("Mission aborted: the planning turn errored.");
      expect(result.milestones).toEqual([]);
      expect(result.success).toBe(false);
    });

    it("does not fail a milestone whose verification failed then passed after repair", async () => {
      // The turn verifies FAIL (fixed.txt absent) → repair → verifies PASS.
      // The outcome must report the LAST verdict. Treating "failed once" as
      // sticky marked a successfully repaired milestone as failed, so with the
      // S1.2 always-probe-final change a repair could never rescue a milestone.
      fs.writeFileSync(
        path.join(tmpDir, "package.json"),
        JSON.stringify({ name: "goal-verify-recovery", scripts: { test: "node check.js" } })
      );
      fs.writeFileSync(
        path.join(tmpDir, "check.js"),
        "process.exit(require('fs').existsSync('fixed.txt') ? 0 : 1);"
      );

      const planResponse: StreamEvent[] = [
        {
          type: "text_delta",
          text: JSON.stringify([
            { id: "1", title: "Repair the failing test", criteria: "fixed.txt exists" },
          ]),
        },
        { type: "turn_end", stopReason: "end_turn" },
      ];

      const writeUnrelated: StreamEvent[] = [
        { type: "tool_call_end", id: "t1", name: "write_file", input: { path: "a.txt", content: "hello" } },
        { type: "turn_end", stopReason: "tool_use" },
      ];
      const endTurnStillFailing: StreamEvent[] = [
        { type: "text_delta", text: "Wrote a.txt but the test still fails." },
        { type: "turn_end", stopReason: "end_turn" },
      ];
      const writeFix: StreamEvent[] = [
        { type: "tool_call_end", id: "t2", name: "write_file", input: { path: "fixed.txt", content: "fixed" } },
        { type: "turn_end", stopReason: "tool_use" },
      ];
      const endTurnFixed: StreamEvent[] = [
        { type: "text_delta", text: "fixed.txt now exists." },
        { type: "turn_end", stopReason: "end_turn" },
      ];

      const provider = new FakeProvider([
        planResponse,
        writeUnrelated,
        endTurnStillFailing,
        writeFix,
        endTurnFixed,
        textTurn("YES — fixed.txt now exists."),
        textTurn("Critic: LGTM"),
      ]);

      const engine = new GoalEngine({
        provider,
        model: "fake-model",
        projectRoot: tmpDir,
        permissionBroker: { async requestPermission() { return true; } },
        autoVerify: "node check.js",
        autoCommit: false,
      });

      const { events, result } = await collect(engine, "Repair the failing test");

      expect(events.some((e: any) => e.type === "milestone_failed")).toBe(false);
      expect(result.success).toBe(true);
      expect(result.milestones[0].status).toBe("completed");
    });

    it("still fails a milestone whose verification never recovers", async () => {
      // Budget exhausts with the final probe still failing → gave_up is
      // terminal and must keep the milestone failed (the guard against
      // over-correcting the fix above).
      fs.writeFileSync(
        path.join(tmpDir, "package.json"),
        JSON.stringify({ name: "goal-verify-norecovery", scripts: { test: "node check.js" } })
      );
      fs.writeFileSync(
        path.join(tmpDir, "check.js"),
        "process.exit(require('fs').existsSync('fixed.txt') ? 0 : 1);"
      );

      const planResponse: StreamEvent[] = [
        {
          type: "text_delta",
          text: JSON.stringify([{ id: "1", title: "Never fixed", criteria: "fixed.txt exists" }]),
        },
        { type: "turn_end", stopReason: "end_turn" },
      ];
      const writeUnrelated: StreamEvent[] = [
        { type: "tool_call_end", id: "t1", name: "write_file", input: { path: "a.txt", content: "hello" } },
        { type: "turn_end", stopReason: "tool_use" },
      ];
      const endTurnStillFailing: StreamEvent[] = [
        { type: "text_delta", text: "Still failing." },
        { type: "turn_end", stopReason: "end_turn" },
      ];

      // Verification fails on every probe: three end-of-turn probes exhaust the
      // two-repair budget, then the final probe still fails → gave_up.
      const provider = new FakeProvider([
        planResponse,
        writeUnrelated,
        endTurnStillFailing,
        endTurnStillFailing,
        endTurnStillFailing,
      ]);

      const engine = new GoalEngine({
        provider,
        model: "fake-model",
        projectRoot: tmpDir,
        permissionBroker: { async requestPermission() { return true; } },
        autoVerify: "node check.js",
        autoCommit: false,
      });

      const { events, result } = await collect(engine, "Never fixed");

      expect(events.some((e: any) => e.type === "milestone_failed")).toBe(true);
      expect(result.success).toBe(false);
      expect(result.milestones[0].status).toBe("failed");
    });
  });
});

describe("isSatisfiedVerdict tolerates a negated defect (2026-10-14)", () => {
  it("accepts a clean YES that states the ABSENCE of a defect", () => {
    for (const verdict of [
      "YES. No issues remain, all tests pass.",
      "YES - no errors remain after the change.",
      "YES. I found no failing tests.",
      "YES. All criteria met, no regressions.",
      "YES. Every test still passes.",
      "YES. The build is green yet again.",
      "YES. Zero errors, zero warnings.",
      "YES. There is nothing missing.",
      "YES, implemented correctly and no further work is needed.",
    ]) {
      expect(isSatisfiedVerdict(verdict), verdict).toBe(true);
    }
  });

  it("still rejects a YES that asserts a defect or negates the work", () => {
    // A failed/absent test run is caught deterministically before this rule is
    // even consulted (runGoalMission fails the milestone on
    // outcome.errored || outcome.verificationFailed), so this list is only the
    // verdict-level wording.
    for (const verdict of [
      "YES. The tests fail.",
      "YES. Criteria not met.",
      "YES. I did not verify the tests.",
      "YES. Not done.",
      "YES. Missing the export.",
      "YES - still broken",
      "YES. The criteria were not all met.",
      "YES. Nothing was verified.",
    ]) {
      expect(isSatisfiedVerdict(verdict), verdict).toBe(false);
    }
  });
});
