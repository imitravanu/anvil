import { describe, expect, it, vi } from "vitest";
import { COMMANDS } from "../../commands/registry.js";
import { HELP_KEYS, filterHelpSections, helpSections } from "../../commands/help.js";
import { InputBar } from "../InputBar.js";
import { HelpOverlay } from "../HelpOverlay.js";
import { frameText, renderThemed, tick } from "../../test-utils/testRender.js";

/**
 * Phase 41 — discoverability. /help used to dump ~40 lines of prose into the
 * transcript (twice the visible window, and it scrolled the user's own turn
 * away). The help surface is now an overlay: every command in the registry,
 * the real keybindings, and a type-to-filter box — closed with one Esc.
 */

const ESC = "\u001B";
const DOWN = "\u001B[B";

describe("helpSections / filterHelpSections", () => {
  it("lists every registered command with its registry description", () => {
    const sections = helpSections();
    const commands = sections.find((s) => s.id === "commands");
    expect(commands).toBeDefined();
    const rows = commands?.rows ?? [];
    for (const command of COMMANDS) {
      expect(rows.some((row) => row.primary === `/${command.name}`)).toBe(true);
      expect(rows.some((row) => row.secondary === command.description)).toBe(true);
    }
  });

  it("documents the real keybindings, not placeholder prose", () => {
    const chords = HELP_KEYS.map((k) => k.primary);
    expect(chords).toContain("Enter");
    expect(chords).toContain("Esc");
    expect(chords).toContain("Ctrl+C");
    expect(chords).toContain("PgUp / PgDn");
    expect(chords).toContain("?");
  });

  it("documents the overlay-only shortcuts in their own section", () => {
    const sections = helpSections();
    const overlays = sections.find((s) => s.id === "overlays");
    expect(overlays).toBeDefined();
    const rows = overlays?.rows ?? [];
    // Diff inspector + permission prompt + pickers — every shortcut an overlay
    // advertises in its own header must also be findable from one screen.
    expect(rows.some((r) => r.secondary.includes("side-by-side"))).toBe(true);
    expect(rows.some((r) => r.secondary.includes("allow once"))).toBe(true);
    expect(rows.some((r) => r.secondary.includes("Backspace"))).toBe(true);
    // Section order: keys first, commands next (inside the first window),
    // overlay-only shortcuts last.
    expect(sections.map((s) => s.id)).toEqual(["keys", "commands", "overlays"]);
  });

  it("filters rows by key, description, and command name (case-insensitive)", () => {
    const filtered = filterHelpSections(helpSections(), "rew");
    const flat = filtered.flatMap((s) => s.rows);
    expect(flat.some((r) => r.primary.includes("/rewind"))).toBe(true);
    expect(flat.some((r) => r.primary.includes("/model"))).toBe(false);
    // Sections with no surviving rows are dropped, not rendered empty.
    expect(filtered.every((s) => s.rows.length > 0)).toBe(true);
  });

  it("returns no sections when nothing matches", () => {
    expect(filterHelpSections(helpSections(), "zzzzzz")).toEqual([]);
  });
});

describe("HelpOverlay", () => {
  it("windows tall content, scrolls with ↓, and closes on Esc", async () => {
    const onClose = vi.fn();
    const app = renderThemed(<HelpOverlay onClose={onClose} />);
    await tick();
    const out = frameText(app.lastFrame);
    expect(out).toContain("/help");
    expect(out).toContain("PgUp / PgDn");
    expect(out).toContain("Esc close");
    // The full reference is taller than one screen: it must be WINDOWED
    // (with an affordance) instead of overflowing the fixed frame.
    expect(out).toContain("more below");
    expect(out).not.toContain("/rewind");

    // Scrolling reaches the rows below the first window (stop as soon as it
    // is in view — the exact offset depends on the harness' row count).
    let scrolledTo = false;
    for (let i = 0; i < 60 && !scrolledTo; i++) {
      app.stdin.write(DOWN);
      await tick(20);
      scrolledTo = frameText(app.lastFrame).includes("/rewind");
    }
    expect(scrolledTo).toBe(true);

    app.stdin.write(ESC);
    await tick();
    expect(onClose).toHaveBeenCalledTimes(1);
    app.unmount();
  });

  it("narrows to matches while typing and says so when nothing matches", async () => {
    const app = renderThemed(<HelpOverlay onClose={() => undefined} />);
    await tick();
    app.stdin.write("rew");
    await tick();
    const narrowed = frameText(app.lastFrame);
    expect(narrowed).toContain("/rewind");
    expect(narrowed).not.toContain("/model");
    app.stdin.write("zzzzzz");
    await tick();
    expect(frameText(app.lastFrame)).toContain("No matching help rows");
    app.unmount();
  });
});

describe("InputBar — ? opens help on an empty prompt", () => {
  it("opens help for a bare ? and does not submit", async () => {
    const onSubmit = vi.fn();
    const onOpenHelp = vi.fn();
    const app = renderThemed(
      <InputBar isBusy={false} onSubmit={onSubmit} onCancel={() => undefined} onOpenHelp={onOpenHelp} />
    );
    await tick();
    app.stdin.write("?");
    await tick();
    expect(onOpenHelp).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
    app.unmount();
  });

  it("still types ? once the draft has text", async () => {
    const onSubmit = vi.fn();
    const onOpenHelp = vi.fn();
    const app = renderThemed(
      <InputBar isBusy={false} onSubmit={onSubmit} onCancel={() => undefined} onOpenHelp={onOpenHelp} />
    );
    await tick();
    app.stdin.write("what?");
    await tick();
    expect(onOpenHelp).not.toHaveBeenCalled();
    expect(frameText(app.lastFrame)).toContain("what?");
    app.unmount();
  });
});
