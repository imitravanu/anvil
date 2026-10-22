import { describe, it, expect, vi } from "vitest";
import { Box, Text } from "ink";
import { InputBar } from "../InputBar.js";
import { PermissionPrompt } from "../PermissionPrompt.js";
import { ScrollViewport } from "../ScrollViewport.js";
import { CommandPalette } from "../CommandPalette.js";
import { Header } from "../Header.js";
import { StatusBar } from "../StatusBar.js";
import { MessageView } from "../MessageView.js";
import { MissionDeck } from "../MissionDeck.js";
import { TextDetail } from "../TextDetail.js";
import { THEMES } from "../../theme/theme.js";
import { displayWidth } from "../../util/format.js";
import { frameText, renderThemed, renderWithTheme, tick } from "../../test-utils/testRender.js";

describe("conversation-first input and review", () => {
  it("scrolls retained details with wheel reports while clicks and pasted reports stay inert", async () => {
    const close = vi.fn();
    const app = renderThemed(<Box height={10}><TextDetail title="Retained text" text={Array.from({ length: 50 }, (_, index) => `detail-row-${index}`).join("\n")} onClose={close} /></Box>);
    await vi.waitFor(() => expect(frameText(app.lastFrame)).toContain("detail-row-0"));
    app.stdin.write("\x1b[<65;10;4M".repeat(4));
    await vi.waitFor(() => expect(frameText(app.lastFrame)).not.toContain("detail-row-0"));
    const frame = frameText(app.lastFrame);
    app.stdin.write("\x1b[200~\x1b[<65;10;4M\x1b[201~\x1b[<0;10;4M"); await tick();
    expect(frameText(app.lastFrame)).toBe(frame);
    expect(close).not.toHaveBeenCalled();
    app.stdin.write("\x1b[<64;10;4M".repeat(40));
    await vi.waitFor(() => expect(frameText(app.lastFrame)).toContain("detail-row-0"));
    app.unmount();
  });

  it("sanitizes external labels and keeps wide custom-theme dividers within the terminal", () => {
    const theme = { ...THEMES.dark, typography: { ...THEMES.dark.typography, sectionDivider: "中+" } };
    const app = renderWithTheme(theme, <Box flexDirection="column"><Header minimal model="fixture" isBusy={false} context={{ projectRoot: "/tmp", projectName: "safe\x1b[2Jname", ecosystem: { type: "node", packageManager: "npm" }, topLevelEntries: [], summary: "" }} /><MissionDeck compact plan={"safe\x1b[2Jplan"} /><InputBar isBusy={false} onSubmit={() => {}} onCancel={() => {}} /></Box>);
    const frame = frameText(app.lastFrame);
    expect(app.lastFrame()).not.toContain("\x1b[2J");
    expect(frame).toContain("safename"); expect(frame).toContain("safeplan");
    expect(frame.split("\n").every(line => displayWidth(line) <= 100)).toBe(true); app.unmount();
  });
  it("groups successful reads without hiding a failed or running tool", () => {
    const app = renderThemed(<MessageView minimal message={{ id: "tools", role: "assistant", text: "", streaming: false, subAgents: [], toolCalls: [
      { id: "a", name: "read_file", input: {}, status: "done" },
      { id: "b", name: "grep", input: {}, status: "done" },
      { id: "c", name: "read_file", input: {}, status: "error", summary: "FAILURE_MUST_STAY_VISIBLE" },
      { id: "d", name: "grep", input: {}, status: "running", summary: "RUNNING_MUST_STAY_VISIBLE" },
    ] }} />);
    const frame = frameText(app.lastFrame);
    expect(frame).toContain("2 reads/searches");
    expect(frame).toContain("FAILURE_MUST_STAY_VISIBLE");
    expect(frame).toContain("RUNNING_MUST_STAY_VISIBLE"); app.unmount();
  });
  it("preserves cursor and draft through an overlay, without input leaking", async () => {
    const submit = vi.fn();
    const bar = (hidden: boolean) => <InputBar isBusy={false} hidden={hidden} onSubmit={submit} onCancel={() => {}} />;
    const app = renderThemed(bar(false)); await tick();
    app.stdin.write("abc"); await tick(); app.stdin.write("\x1b[D"); await tick();
    app.rerender(bar(true)); await tick(); app.stdin.write("leak"); await tick();
    app.rerender(bar(false)); await tick(); app.stdin.write("X"); await tick(); app.stdin.write("\r"); await tick();
    expect(submit).toHaveBeenCalledWith("abXc"); app.unmount();
  });
  it("keeps drafts isolated by session and restores the previous session", async () => {
    const submit = vi.fn();
    const bar = (sessionId: string) => <InputBar sessionId={sessionId} isBusy={false} onSubmit={submit} onCancel={() => {}} />;
    const app = renderThemed(bar("a")); await tick(); app.stdin.write("draft A"); await tick();
    app.rerender(bar("b")); await tick(); app.stdin.write("draft B"); await tick();
    app.rerender(bar("a")); await tick(); app.stdin.write("\r"); await tick();
    expect(submit).toHaveBeenCalledWith("draft A"); app.unmount();
  });
  it("retains rejected input and a new draft typed during async submission", async () => {
    const submit = vi.fn().mockResolvedValue(false);
    const app = renderThemed(<InputBar isBusy onSubmit={submit} onCancel={() => {}} />); await tick();
    app.stdin.write("keep me"); await tick(); app.stdin.write("\r"); await tick();
    expect(frameText(app.lastFrame)).toContain("keep me");
    expect(frameText(app.lastFrame)).toContain("preserved"); app.unmount();
  });
  it("bracketed paste preserves code/trailing newline and never executes slash text", async () => {
    const submit = vi.fn();
    const app = renderThemed(<InputBar isBusy={false} onSubmit={submit} onCancel={() => {}} />); await tick();
    app.stdin.write("\x1b[200~/clear\n  const x = 1;\n\x1b[201~"); await tick();
    expect(submit).not.toHaveBeenCalled();
    expect(frameText(app.lastFrame)).not.toContain("Commands");
    app.stdin.write("\r"); await tick();
    expect(submit).toHaveBeenCalledWith("/clear\n  const x = 1;\n", true); app.unmount();
  });
  it("inserts LF as a newline and deletes a whole grapheme", async () => {
    const submit = vi.fn();
    const app = renderThemed(<InputBar isBusy={false} onSubmit={submit} onCancel={() => {}} />); await tick();
    for (const chunk of ["a", "\n", "e\u0301", "\x7f", "b", "\r"]) { app.stdin.write(chunk); await tick(); }
    expect(submit).toHaveBeenCalledWith("a\nb"); app.unmount();
  });
  it("dismisses slash suggestions without deleting the command draft", async () => {
    const app = renderThemed(<InputBar isBusy={false} onSubmit={() => {}} onCancel={() => {}} />); await tick();
    app.stdin.write("/model"); await tick(); app.stdin.write("\x1b"); await tick();
    expect(frameText(app.lastFrame)).toContain("/model");
    expect(frameText(app.lastFrame)).not.toContain("Commands"); app.unmount();
  });
  it("supports a typed literal slash message without running its command", async () => {
    const submit = vi.fn();
    const app = renderThemed(<InputBar isBusy={false} onSubmit={submit} onCancel={() => {}} />); await tick();
    for (const chunk of ["/clear", "\x0c", "\r"]) { app.stdin.write(chunk); await tick(); }
    expect(submit).toHaveBeenCalledWith("/clear", true); app.unmount();
  });
  it("can return from input history to the original unsent draft", async () => {
    const submit = vi.fn();
    const app = renderThemed(<InputBar isBusy={false} sentHistory={["old"]} onSubmit={submit} onCancel={() => {}} />); await tick();
    for (const chunk of ["original", "\x1b[A", "\x1b[B", "\r"]) { app.stdin.write(chunk); await tick(); }
    expect(submit).toHaveBeenCalledWith("original"); app.unmount();
  });
  it("does not consent to pasted approval shortcuts", async () => {
    const resolve = vi.fn(); const approve = vi.fn();
    const app = renderThemed(<PermissionPrompt request={{ toolName: "run_command", summary: "danger", resolve }} broker={{ approveAlwaysForSession: approve }} />); await tick();
    app.stdin.write("\x1b[200~ya\r\x1b[201~"); await tick();
    expect(resolve).not.toHaveBeenCalled(); expect(approve).not.toHaveBeenCalled(); app.unmount();
  });
  it("reviews the end of a long permission diff without approving", async () => {
    const resolve = vi.fn();
    const summary = Array.from({ length: 100 }, (_, index) => `+line ${index} ${index === 99 ? "LAST_CHANGE" : ""}`).join("\n");
    const app = renderThemed(<PermissionPrompt request={{ toolName: "edit_file", summary, resolve }} broker={{ approveAlwaysForSession: () => {} }} />); await tick();
    expect(frameText(app.lastFrame)).not.toContain("LAST_CHANGE");
    app.stdin.write("G"); await tick(); expect(frameText(app.lastFrame)).toContain("LAST_CHANGE");
    expect(resolve).not.toHaveBeenCalled(); app.unmount();
  });
  it("scrolls inside one long message using measured rows", async () => {
    let maximum = 0;
    const content = Array.from({ length: 50 }, (_, index) => `row-${index}`).join("\n");
    const view = (offset: number) => <Box height={5}><ScrollViewport offset={offset} onBounds={value => { maximum = value; }}><Text>{content}</Text></ScrollViewport></Box>;
    const app = renderThemed(view(0)); await tick();
    expect(maximum).toBe(45); expect(frameText(app.lastFrame)).toContain("row-49");
    app.rerender(view(maximum)); await tick();
    expect(frameText(app.lastFrame)).toContain("row-0"); expect(frameText(app.lastFrame)).not.toContain("row-49"); app.unmount();
  });
  it("windows command results rather than rendering the entire registry", () => {
    const app = renderThemed(<CommandPalette query="" highlight={10} />);
    expect(frameText(app.lastFrame).split("\n").length).toBeLessThan(24); app.unmount();
  });
  it("keeps default shell identity and usage in separate homes", () => {
    const app = renderThemed(<Box flexDirection="column"><Header minimal model="gemini-3.6-flash" isBusy={false} /><StatusBar minimal model="gemini-3.6-flash" isBusy={false} usage={{ inputTokens: 9999999, outputTokens: 1 }} contextEstimate={{ tokens: 1000, limit: 10000 }} /></Box>);
    const frame = frameText(app.lastFrame);
    expect(frame).not.toContain("9,999,999"); expect(frame).toContain("context ~10%"); app.unmount();
  });
});
