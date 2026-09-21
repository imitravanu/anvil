import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { FirstRunSetup } from "../FirstRunSetup.js";
import { frameText, renderThemed, tick } from "../../test-utils/testRender.js";

const ENTER = "\r";
const DOWN = "\u001B[B";

/**
 * The connect flow writes ~/.anvil/credentials.json through core's
 * `saveCredential`, which honors ANVIL_HOME — so the failure path is driven
 * through the real env hook (the same pattern core's config tests use), not a
 * module mock. The "home" is a FILE, so any write under it fails with ENOTDIR:
 * deterministic on every platform, unlike chmod games (which root ignores).
 */
function brokenHome(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "anvil-setup-"));
  const file = path.join(dir, "not-a-dir");
  fs.writeFileSync(file, "x");
  return path.join(file, "child");
}

const cleanups: (() => void)[] = [];
let savedHome: string | undefined;

function setAnvilHome(p: string): void {
  savedHome = process.env.ANVIL_HOME;
  process.env.ANVIL_HOME = p;
  cleanups.push(() => {
    if (savedHome === undefined) delete process.env.ANVIL_HOME;
    else process.env.ANVIL_HOME = savedHome;
  });
}

afterEach(() => {
  for (const fn of cleanups.splice(0)) fn();
});

async function typeKeyAndSubmit(key: string): Promise<ReturnType<typeof renderThemed>> {
  // onDone is required; the flow never reaches the done step in these tests.
  const app = renderThemed(<FirstRunSetup onDone={vi.fn()} />);
  await tick();
  app.stdin.write(ENTER); // provider step: anthropic (first row)
  await tick();
  app.stdin.write(key);
  await tick();
  app.stdin.write(ENTER); // submit
  await tick();
  return app;
}

describe("FirstRunSetup", () => {
  it("survives an unwritable home: shows the error and stays on the key step", async () => {
    // Regression: saveCredential ran bare inside the Ink input handler, so a
    // full disk / unwritable home threw out of the handler as an uncaught
    // exception and killed the process mid-onboarding.
    setAnvilHome(brokenHome());
    const app = await typeKeyAndSubmit("sk-test-123");
    const out = frameText(app.lastFrame);
    expect(out).toContain("Could not save the key");
    // Still on the key step (masked input renders as asterisks, not the key).
    expect(out).toContain("Step 2 of 2");
    expect(out).toContain("press Enter again");
    expect(out).not.toContain("API key saved.");
    app.unmount();
  });

  it("completes the flow when the save succeeds", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "anvil-setup-ok-"));
    setAnvilHome(dir);
    const app = await typeKeyAndSubmit("sk-test-123");
    const out = frameText(app.lastFrame);
    expect(out).toContain("API key saved.");
    expect(fs.existsSync(path.join(dir, "credentials.json"))).toBe(true);
    app.unmount();
  });
});
