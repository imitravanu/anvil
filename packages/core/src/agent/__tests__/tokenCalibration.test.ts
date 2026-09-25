import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AgentSession, type AgentEvent } from "../index.js";
import { FakeProvider } from "./fakeProvider.js";
import { registerModel, unregisterModels } from "../../providers/registry.js";
import type { StreamEvent } from "../../providers/types.js";

const FAKE_MODEL = "fake-calibration-model";

afterEach(() => unregisterModels([FAKE_MODEL]));

async function drain(gen: AsyncGenerator<AgentEvent>): Promise<void> {
  for await (const event of gen) {
    if (event.type === "error") throw new Error(event.message);
  }
}

function makeSession(root: string, script: StreamEvent[]): AgentSession {
  return new AgentSession(new FakeProvider([script]), {
    systemPrompt: "test",
    model: FAKE_MODEL,
    maxTokens: 1024,
    projectRoot: root,
    permissionBroker: { async requestPermission() { return true; } },
  });
}

describe("session token calibration", () => {
  it("starts uncalibrated and learns from the provider's measured usage", async () => {
    registerModel({
      id: FAKE_MODEL,
      providerId: "anthropic",
      displayName: "Fake Calibrated",
      contextWindow: 200_000,
      supportsTools: true,
      supportsVision: false,
    });
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "anvil-calib-"));
    // The provider reports FAR more input tokens than a chars/4 estimate
    // predicts (history ~50 est vs 400 reported): the factor must move up, and
    // stay inside the clamp so one odd response cannot drive compaction wild.
    const session = makeSession(root, [
      { type: "text_delta", text: "ok" },
      { type: "usage", inputTokens: 400, outputTokens: 2 },
      { type: "turn_end", stopReason: "end_turn" },
    ]);
    expect(session.tokenCalibration).toBe(1);
    await drain(session.send("a".repeat(200)));
    expect(session.tokenCalibration).toBeGreaterThan(1);
    expect(session.tokenCalibration).toBeLessThanOrEqual(2);
    await fs.rm(root, { recursive: true, force: true });
  });
});
