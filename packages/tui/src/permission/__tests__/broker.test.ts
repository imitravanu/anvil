import { describe, expect, it } from "vitest";
import { TuiPermissionBroker } from "../TuiPermissionBroker.js";
import type { PendingPermissionRequest } from "../TuiPermissionBroker.js";

describe("TuiPermissionBroker", () => {
  it("serves concurrent requests FIFO without orphaning promises", async () => {
    const broker = new TuiPermissionBroker();
    let current: PendingPermissionRequest | null = null;
    const heads: string[] = [];
    const unsub = broker.subscribe((req) => {
      current = req;
      if (req) heads.push(req.toolName);
    });
    const first = broker.requestPermission("edit_file", "diff 1");
    const second = broker.requestPermission("run_command", "cmd");
    // Only the head is current; nothing auto-resolves.
    expect(heads).toEqual(["edit_file"]);
    let firstDone = false;
    let secondDone = false;
    void first.then(() => {
      firstDone = true;
    });
    void second.then(() => {
      secondDone = true;
    });
    await Promise.resolve();
    expect(firstDone).toBe(false);
    expect(secondDone).toBe(false);
    // Resolve the head: the second request must surface, then resolve too.
    current!.resolve(true);
    await expect(first).resolves.toBe(true);
    expect(heads).toEqual(["edit_file", "run_command"]);
    current!.resolve(false);
    await expect(second).resolves.toBe(false);
    expect(firstDone).toBe(true);
    expect(secondDone).toBe(true);
    unsub();
  });

  it("always-approve short-circuits without queueing", async () => {
    const broker = new TuiPermissionBroker();
    broker.approveAlwaysForSession("read_file");
    await expect(broker.requestPermission("read_file", "x")).resolves.toBe(true);
    const seen: string[] = [];
    const unsub = broker.subscribe((req) => {
      if (req) seen.push(req.toolName);
    });
    expect(seen).toEqual([]);
    unsub();
  });

  it("unsubscribe stops notifications", async () => {
    const broker = new TuiPermissionBroker();
    const seen: string[] = [];
    const unsub = broker.subscribe((req) => {
      if (req) seen.push(req.toolName);
    });
    unsub();
    let current: PendingPermissionRequest | null = null;
    const watch = broker.subscribe((req) => {
      current = req;
    });
    const pending = broker.requestPermission("edit_file", "x");
    expect(seen).toEqual([]); // unsubscribed listener heard nothing
    current!.resolve(false);
    await expect(pending).resolves.toBe(false);
    watch();
  });
});
