import { describe, expect, it, vi } from "vitest";
import { InputBar } from "../InputBar.js";
import { frameText, renderThemed, tick } from "../../test-utils/testRender.js";

const ENTER = "\r";
const ESC = "\u001B";
const UP = "\u001B[A";
const DOWN = "\u001B[B";

function idleBar(over: Record<string, unknown> = {}) {
  const onSubmit = vi.fn();
  const onCancel = vi.fn();
  const app = renderThemed(
    <InputBar isBusy={false} onSubmit={onSubmit} onCancel={onCancel} {...(over as object)} />
  );
  return { app, onSubmit, onCancel };
}

describe("InputBar", () => {
  it("echoes typing and submits trimmed text on Enter, then clears", async () => {
    const { app, onSubmit } = idleBar();
    await tick();
    app.stdin.write("  hello anvil  ");
    await tick();
    expect(frameText(app.lastFrame)).toContain("hello anvil");
    app.stdin.write(ENTER);
    await tick();
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith("hello anvil");
    expect(frameText(app.lastFrame)).not.toContain("hello anvil");
    app.unmount();
  });

  it("ignores empty submits", async () => {
    const { app, onSubmit } = idleBar();
    await tick();
    app.stdin.write(ENTER);
    await tick();
    expect(onSubmit).not.toHaveBeenCalled();
    app.unmount();
  });

  it("opens the command menu on / and dismisses on Esc", async () => {
    const { app } = idleBar();
    await tick();
    app.stdin.write("/");
    await tick();
    const menu = frameText(app.lastFrame);
    expect(menu).toContain("/help");
    expect(menu).toContain("/model");
    app.stdin.write("xyz");
    await tick();
    expect(frameText(app.lastFrame)).toContain("No matching commands.");
    app.stdin.write(ESC);
    await tick();
    expect(frameText(app.lastFrame)).not.toContain("No matching commands.");
    app.unmount();
  });

  it("Enter with the menu open runs the highlighted command", async () => {
    const { app, onSubmit } = idleBar();
    await tick();
    app.stdin.write("/he");
    await tick();
    app.stdin.write(ENTER);
    await tick();
    expect(onSubmit).toHaveBeenCalledWith("/help");
    app.unmount();
  });

  it("Up recalls sent history newest-first, Down walks back", async () => {
    const { app } = idleBar({ sentHistory: ["first", "second"] });
    await tick();
    app.stdin.write(UP);
    await tick();
    expect(frameText(app.lastFrame)).toContain("second");
    app.stdin.write(UP);
    await tick();
    expect(frameText(app.lastFrame)).toContain("first");
    app.stdin.write(DOWN);
    await tick();
    expect(frameText(app.lastFrame)).toContain("second");
    app.unmount();
  });

  it("Esc while busy cancels; Enter while busy never submits", async () => {
    const onSubmit = vi.fn();
    const onCancel = vi.fn();
    const app = renderThemed(<InputBar isBusy onSubmit={onSubmit} onCancel={onCancel} />);
    await tick();
    app.stdin.write("typed-while-busy");
    await tick();
    app.stdin.write(ENTER);
    await tick();
    expect(onSubmit).not.toHaveBeenCalled();
    app.stdin.write(ESC);
    await tick();
    expect(onCancel).toHaveBeenCalledTimes(1);
    app.unmount();
  });
});
