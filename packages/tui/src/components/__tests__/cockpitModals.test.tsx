import { describe, expect, it, vi } from "vitest";
import { DiffModal } from "../DiffModal.js";
import { RewindModal } from "../RewindModal.js";
import { frameText, renderThemed } from "../../test-utils/testRender.js";
import type { AgentSession, CheckpointMeta, SessionFileChange } from "@anvil/core";

function mockSession(over: {
  changes?: SessionFileChange[];
  checkpoints?: CheckpointMeta[];
  coverage?: { baselineDropped: number; ringDropped: number };
}): AgentSession {
  return {
    summarizeChanges: vi.fn().mockResolvedValue(over.changes ?? []),
    getCheckpoints: vi.fn().mockReturnValue(over.checkpoints ?? []),
    diffCoverage: vi.fn().mockReturnValue(over.coverage ?? { baselineDropped: 0, ringDropped: 0 }),
  } as unknown as AgentSession;
}

describe("DiffModal", () => {
  it("renders empty notice when session has no file changes", async () => {
    const session = mockSession({ changes: [] });
    const onClose = vi.fn();
    const { lastFrame, unmount } = renderThemed(
      <DiffModal session={session} onClose={onClose} />
    );

    // Wait for async summarizeChanges promise
    await new Promise((r) => setTimeout(r, 20));

    const out = frameText(lastFrame);
    expect(out).toContain("Diff Inspector");
    expect(out).toContain("No files modified");
    unmount();
  });

  it("renders file tabs and diff content when changes exist", async () => {
    const changes: SessionFileChange[] = [
      {
        path: "src/auth.ts",
        kind: "modified",
        diff: "@@ -1,2 +1,2 @@\n-const old = 1;\n+const next = 2;",
      },
    ];
    const session = mockSession({ changes });
    const onClose = vi.fn();
    const { lastFrame, unmount } = renderThemed(
      <DiffModal session={session} onClose={onClose} />
    );

    await new Promise((r) => setTimeout(r, 20));

    const out = frameText(lastFrame);
    expect(out).toContain("Diff Inspector");
    expect(out).toContain("src/auth.ts");
    expect(out).toContain("~ modified");
    expect(out).toContain("old");
    expect(out).toContain("next");
    unmount();
  });

  it("warns when the bounded baseline dropped paths (coverage honesty)", async () => {
    const changes: SessionFileChange[] = [
      { path: "src/auth.ts", kind: "modified", diff: "@@ -1 +1 @@\n-const old = 1;\n+const next = 2;" },
    ];
    const session = mockSession({ changes, coverage: { baselineDropped: 3, ringDropped: 0 } });
    const { lastFrame, unmount } = renderThemed(
      <DiffModal session={session} onClose={() => {}} />
    );

    await new Promise((r) => setTimeout(r, 20));

    const out = frameText(lastFrame);
    expect(out).toContain("Review incomplete");
    expect(out).toContain("3 path(s)");
    unmount();
  });

  it("renders branch diff when branchDiff prop is provided", () => {
    const session = mockSession({});
    const onClose = vi.fn();
    const branchDiff = {
      branch: "main",
      diff: "@@ -1,2 +1,2 @@\n-feature_a\n+feature_b",
    };
    const { lastFrame, unmount } = renderThemed(
      <DiffModal session={session} onClose={onClose} branchDiff={branchDiff} />
    );

    const out = frameText(lastFrame);
    expect(out).toContain("Branch Diff (main...HEAD)");
    expect(out).toContain("feature_a");
    expect(out).toContain("feature_b");
    unmount();
  });

  it("renders clean notice when branchDiff has no changes", () => {
    const session = mockSession({});
    const onClose = vi.fn();
    const branchDiff = { branch: "main", diff: "" };
    const { lastFrame, unmount } = renderThemed(
      <DiffModal session={session} onClose={onClose} branchDiff={branchDiff} />
    );

    const out = frameText(lastFrame);
    expect(out).toContain("Branch Diff (main...HEAD)");
    expect(out).toContain('No differences between branch "main" and HEAD.');
    unmount();
  });
});

describe("RewindModal", () => {
  it("renders empty notice when no checkpoints exist", () => {
    const session = mockSession({ checkpoints: [] });
    const onSelect = vi.fn();
    const onClose = vi.fn();
    const { lastFrame, unmount } = renderThemed(
      <RewindModal session={session} onSelect={onSelect} onClose={onClose} />
    );
    const out = frameText(lastFrame);
    expect(out).toContain("Time-Travel Checkpoint Rewind");
    expect(out).toContain("No checkpoints recorded");
    unmount();
  });

  it("renders checkpoint timeline and selection cursor", () => {
    const checkpoints: CheckpointMeta[] = [
      { id: 1, files: 2, skipped: 0, ts: new Date(Date.now() - 60000).toISOString() },
      { id: 2, files: 1, skipped: 0, ts: new Date().toISOString() },
    ];
    const session = mockSession({ checkpoints });
    const onSelect = vi.fn();
    const onClose = vi.fn();
    const { lastFrame, unmount } = renderThemed(
      <RewindModal session={session} onSelect={onSelect} onClose={onClose} />
    );
    const out = frameText(lastFrame);
    expect(out).toContain("Time-Travel Checkpoint Rewind");
    expect(out).toContain("#1");
    expect(out).toContain("2 files snapshotted");
    expect(out).toContain("#2");
    expect(out).toContain("1 file snapshotted");
    expect(out).toContain("❯");
    unmount();
  });
});
