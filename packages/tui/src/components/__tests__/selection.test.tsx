import { afterEach, describe, expect, it, vi } from "vitest";
import { Box, Text } from "ink";
import { cleanup } from "ink-testing-library";
import { SelectableRegion } from "../SelectableRegion.js";
import { frameText, renderThemed, tick } from "../../test-utils/testRender.js";

const copy = vi.hoisted(() => vi.fn(async () => ({ ok: true, reason: "copied", confirmed: true })));
vi.mock("../../util/clipboard.js", () => ({ copySelection: copy }));
afterEach(() => { cleanup(); copy.mockClear(); });
const report = (button: number, x: number, y: number, release = false) => `\x1b[<${button};${x};${y}${release ? "m" : "M"}`;

describe("drag selection", () => {
  it("copies exactly the dragged visible text once, including release without a motion report", async () => {
    const notice = vi.fn();
    const app = renderThemed(<Box height={6}><SelectableRegion onNotice={notice}><Text>Alpha beta</Text></SelectableRegion></Box>);
    await tick();
    app.stdin.write(report(0, 1, 1)); app.stdin.write(report(32, 5, 1)); await tick();
    expect(copy).not.toHaveBeenCalled();
    app.stdin.write(report(0, 5, 1, true));
    await vi.waitFor(() => expect(copy).toHaveBeenCalledWith("Alpha", expect.anything()));
    app.stdin.write(report(0, 5, 1, true)); await tick();
    expect(copy).toHaveBeenCalledTimes(1);
    expect(notice).toHaveBeenCalledWith("Copied selection");
    app.stdin.write(report(0, 7, 1)); app.stdin.write(report(0, 10, 1, true));
    await vi.waitFor(() => expect(copy).toHaveBeenLastCalledWith("beta", expect.anything()));
  });

  it("freezes the selected frame during streaming; wheel clears it and returns to live content", async () => {
    const view = (text: string) => <Box height={6}><SelectableRegion><Text>{text}</Text></SelectableRegion></Box>;
    const app = renderThemed(view("Alpha beta")); await tick();
    app.stdin.write(report(0, 1, 1)); await tick(); app.rerender(view("REPLACED live output")); await tick();
    expect(frameText(app.lastFrame)).toContain("Alpha beta");
    expect(frameText(app.lastFrame)).not.toContain("REPLACED");
    app.stdin.write(report(0, 5, 1, true));
    await vi.waitFor(() => expect(copy).toHaveBeenCalledWith("Alpha", expect.anything()));
    app.stdin.write(report(65, 3, 2));
    await vi.waitFor(() => expect(frameText(app.lastFrame)).toContain("REPLACED"));
  });

  it("copies reverse multiline selections with indentation and whole grapheme clusters", async () => {
    const view = (text: string) => <Box height={6}><SelectableRegion><Text>{text}</Text></SelectableRegion></Box>;
    const app = renderThemed(view("first\n  second")); await tick();
    app.stdin.write(report(0, 8, 2)); app.stdin.write(report(32, 1, 1)); app.stdin.write(report(0, 1, 1, true));
    await vi.waitFor(() => expect(copy).toHaveBeenCalledWith("first\n  second", expect.anything()));
    app.stdin.write("x"); await tick(); app.rerender(view("A中e\u0301👩‍💻Z")); await tick();
    app.stdin.write(report(0, 3, 1)); app.stdin.write(report(0, 6, 1, true));
    await vi.waitFor(() => expect(copy).toHaveBeenLastCalledWith("中e\u0301👩‍💻", expect.anything()));
  });

  it("ignores clicks, right drags, paste and disabled regions", async () => {
    const view = (enabled: boolean) => <Box height={6}><SelectableRegion enabled={enabled}><Text>Alpha beta</Text></SelectableRegion></Box>;
    const app = renderThemed(view(true)); await tick();
    for (const input of [report(0, 1, 1), report(0, 1, 1, true), report(2, 1, 1), report(34, 5, 1), report(2, 5, 1, true)]) app.stdin.write(input);
    await tick(); expect(copy).not.toHaveBeenCalled();
    app.rerender(view(false)); await tick();
    app.stdin.write(report(0, 1, 1)); app.stdin.write(report(0, 5, 1, true)); await tick();
    expect(copy).not.toHaveBeenCalled();
  });

  it("copies clipped visible rows rather than hidden source content", async () => {
    const app = renderThemed(<Box height={3} width={20}><SelectableRegion><Box position="absolute" top={-2}><Text>{"hiddenA\nhiddenB\nvisibleC\nvisibleD\nvisibleE"}</Text></Box></SelectableRegion></Box>);
    await tick();
    expect(frameText(app.lastFrame)).toContain("visibleC");
    app.stdin.write(report(0, 1, 1)); app.stdin.write(report(0, 8, 1, true));
    await vi.waitFor(() => expect(copy).toHaveBeenCalledWith("visibleC", expect.anything()));
  });

  it("cancels a drag after geometry changes rather than copying shifted text", async () => {
    const view = (width: number) => <Box width={width} height={6}><SelectableRegion><Text>Alpha beta</Text></SelectableRegion></Box>;
    const app = renderThemed(view(20)); await tick();
    app.stdin.write(report(0, 1, 1)); await tick();
    app.rerender(view(30)); await tick();
    app.stdin.write(report(0, 5, 1, true)); await tick();
    expect(copy).not.toHaveBeenCalled();
  });

  it("serializes clipboard writes and retains only the newest pending selection", async () => {
    let finish!: () => void;
    const gate = new Promise<void>(resolve => { finish = resolve; });
    copy.mockImplementationOnce(async () => { await gate; return { ok: true, reason: "copied", confirmed: true }; });
    const app = renderThemed(<Box height={6}><SelectableRegion><Text>Alpha beta gamma</Text></SelectableRegion></Box>); await tick();
    for (const [from, to] of [[1, 5], [7, 10], [12, 16]]) {
      app.stdin.write(report(0, from, 1)); app.stdin.write(report(0, to, 1, true));
    }
    await tick(); expect(copy).toHaveBeenCalledTimes(1);
    finish();
    await vi.waitFor(() => expect(copy).toHaveBeenCalledTimes(2));
    expect(copy).toHaveBeenLastCalledWith("gamma", expect.anything());
  });
});
