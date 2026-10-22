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
  it("shows the full placeholder with a visible block cursor when empty", async () => {
    const { app } = idleBar();
    await tick();
    const frame = frameText(app.lastFrame);
    // Regression: the library's inverse-video cursor ate the first
    // placeholder char on some terminals ("ype a message").
    expect(frame).toContain("Type a message, / for commands");
    expect(frame).toContain("█");
    app.unmount();
  });

  it("preserves the exact payload on Enter, then clears", async () => {
    const { app, onSubmit } = idleBar();
    await tick();
    app.stdin.write("  hello anvil  ");
    await tick();
    expect(frameText(app.lastFrame)).toContain("hello anvil");
    app.stdin.write(ENTER);
    await tick();
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith("  hello anvil  ");
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

  it("Esc while busy cancels; Enter while busy submits (caller queues)", async () => {
    const onSubmit = vi.fn();
    const onCancel = vi.fn();
    const app = renderThemed(<InputBar isBusy onSubmit={onSubmit} onCancel={onCancel} />);
    await tick();
    app.stdin.write("typed-while-busy");
    await tick();
    app.stdin.write(ENTER);
    await tick();
    // Busy routing moved upstream: the bar always submits, handleSubmit
    // decides whether it runs now or queues.
    expect(onSubmit).toHaveBeenCalledWith("typed-while-busy");
    app.stdin.write(ESC);
    await tick();
    expect(onCancel).toHaveBeenCalledTimes(1);
    app.unmount();
  });

  it("preserves multiline paste and does not submit prematurely", async () => {
    const { app, onSubmit } = idleBar();
    await tick();
    app.stdin.write("line one\nline two\n");
    await tick();
    expect(onSubmit).not.toHaveBeenCalled();
    expect(frameText(app.lastFrame)).toContain("line one");
    expect(frameText(app.lastFrame)).toContain("line two");
    app.stdin.write(ENTER); await tick();
    expect(onSubmit).toHaveBeenCalledWith("line one\nline two\n", true);
    app.unmount();
  });

  it("expands tabs and strips other C0 controls from pasted input (F2)", async () => {
    // F2/AUDIT-2026-09-30: only CR/LF were neutralized — a pasted \t, BEL, or
    // FF reached the value and rendered raw, desyncing the frame.
    const { app } = idleBar();
    await tick();
    app.stdin.write("a\tb\u0007c");
    await tick();
    const raw = app.lastFrame() ?? "";
    expect(raw).not.toContain("\u0007");
    expect(frameText(app.lastFrame)).toContain("a  bc");
    app.unmount();
  });

  it("unfocused bar shows the transcript hint and ignores history recall", async () => {
    const onSubmit = vi.fn();
    const onCancel = vi.fn();
    const app = renderThemed(
      <InputBar isBusy={false} hasFocus={false} onSubmit={onSubmit} onCancel={onCancel} sentHistory={["old"]} />
    );
    await tick();
    expect(frameText(app.lastFrame)).toContain("transcript focused \u2014 Tab to type");
    app.stdin.write(UP);
    await tick();
    expect(onSubmit).not.toHaveBeenCalled();
    expect(frameText(app.lastFrame)).not.toContain("old");
    app.unmount();
  });

  it("reports slash-menu open state for App-level Tab routing", async () => {
    const seen: boolean[] = [];
    const app = renderThemed(
      <InputBar
        isBusy={false}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
        onSlashMenuChange={(open) => { seen.push(open); }}
      />
    );
    await tick();
    app.stdin.write("/");
    await tick();
    expect(seen).toContain(true);
    app.stdin.write(ESC);
    await tick();
    expect(seen).toContain(false);
    app.unmount();
  });
});
