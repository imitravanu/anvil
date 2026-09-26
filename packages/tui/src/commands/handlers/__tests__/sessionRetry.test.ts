import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { handleRetryLast } from "../session.js";
import type { CommandHandlerDeps } from "../../types.js";

/**
 * AUDIT-16: `/retry` used to re-send text only. `send` carries just the CURRENT
 * pending-images set — empty during a retry — so an attached `/image` was
 * silently dropped from the retried turn. These tests pin the re-attachment.
 */

const dirs: string[] = [];

function tmpPng(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "anvil-retry-"));
  dirs.push(dir);
  const p = path.join(dir, "shot.png");
  fs.writeFileSync(p, Buffer.alloc(32, 7));
  return p;
}

afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function deps(messages: unknown[]) {
  const printed: string[] = [];
  const addPendingImage = vi.fn();
  const send = vi.fn(async () => undefined);
  const replaceMessages = vi.fn();
  return {
    printed,
    addPendingImage,
    send,
    replaceMessages,
    deps: {
      isBusy: false,
      printSystemMessage: (t: string) => printed.push(t),
      addPendingImage,
      send,
      replaceMessages,
      messages,
      session: { popLastUserTurn: () => "run the tests" },
    } as unknown as CommandHandlerDeps,
  };
}

describe("handleRetryLast", () => {
  it("re-attaches the retried turn's images so they are not silently dropped (AUDIT-16)", () => {
    const p = tmpPng();
    const messages = [
      { id: "u1", role: "user", text: "look at this", images: [{ path: p }] },
      { id: "a1", role: "assistant", text: "ok" },
    ];
    const { printed, addPendingImage, send, deps: d } = deps(messages);
    handleRetryLast(d);

    expect(addPendingImage).toHaveBeenCalledTimes(1);
    expect(addPendingImage.mock.calls[0][0]).toMatchObject({ mediaType: "image/png", path: p });
    expect(send).toHaveBeenCalledWith("run the tests");
    expect(printed.join("\n")).toContain("Re-attached 1 image");
  });

  it("still retries when an attachment can no longer be read, and says so", () => {
    const messages = [
      {
        id: "u1",
        role: "user",
        text: "look at this",
        images: [{ path: path.join(os.tmpdir(), "anvil-gone-xyz.png") }],
      },
    ];
    const { printed, addPendingImage, send, deps: d } = deps(messages);
    handleRetryLast(d);

    expect(addPendingImage).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalled();
    expect(printed.join("\n")).toContain("Could not re-attach");
  });

  it("says nothing about images when the retried turn had none", () => {
    const messages = [{ id: "u1", role: "user", text: "hi" }];
    const { printed, addPendingImage, deps: d } = deps(messages);
    handleRetryLast(d);

    expect(addPendingImage).not.toHaveBeenCalled();
    const out = printed.join("\n");
    expect(out).toContain("Retrying your last message.");
    expect(out).not.toContain("Re-attached");
  });
});
