import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { GoalEngine, parseMilestones } from "../goalEngine.js";
import { FakeProvider, ScriptEntry } from "../../__tests__/fakeProvider.js";
import { StreamEvent } from "../../../providers/types.js";

const textTurn = (text: string): StreamEvent[] => [
  { type: "text_delta", text },
  { type: "turn_end", stopReason: "end_turn" },
];

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
