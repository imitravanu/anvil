import { describe, expect, it } from "vitest";
import { commandIcon, filterCommands } from "../palette.js";
import { COMMANDS } from "../registry.js";
import { CommandPalette } from "../../components/CommandPalette.js";
import { frameText, renderThemed } from "../../test-utils/testRender.js";

describe("filterCommands", () => {
  it("empty query lists everything in registry order", () => {
    expect(filterCommands(COMMANDS, "").map((c) => c.name)).toEqual(COMMANDS.map((c) => c.name));
  });

  it("prefix matches rank first", () => {
    const names = filterCommands(COMMANDS, "m").map((c) => c.name);
    expect(names[0]).toBe("model");
    expect(names).toContain("mcp");
  });

  it("fuzzy subsequence matches follow prefix matches", () => {
    // "te": team is a prefix hit; theme (t-h-e) and context (t…e) are fuzzy.
    const names = filterCommands(COMMANDS, "te").map((c) => c.name);
    expect(names.slice(0, 3)).toEqual(["team", "theme", "context"]);
  });

  it("MRU boosts within the same rank", () => {
    const plain = filterCommands(COMMANDS, "").map((c) => c.name);
    expect(plain[0]).not.toBe("theme");
    const boosted = filterCommands(COMMANDS, "", ["theme", "diff"]).map((c) => c.name);
    expect(boosted[0]).toBe("theme");
    expect(boosted[1]).toBe("diff");
  });

  it("no match returns empty", () => {
    expect(filterCommands(COMMANDS, "zzz-nope")).toEqual([]);
  });

  it("matching is case-insensitive", () => {
    expect(filterCommands(COMMANDS, "MODEL").map((c) => c.name)).toContain("model");
  });
});

describe("commandIcon", () => {
  it("maps known commands and falls back to a dot", () => {
    expect(commandIcon("goal")).toBe("🎯");
    expect(commandIcon("model")).toBe("🔄");
    expect(commandIcon("no-such-command")).toBe("•");
  });
});

describe("CommandPalette render", () => {
  it("shows icons, footer hints, and the empty state", () => {
    const full = renderThemed(<CommandPalette query="" highlight={0} mru={[]} />);
    const out = frameText(full.lastFrame);
    expect(out).toContain("🎯");
    expect(out).toContain("/goal");
    expect(out).toContain("↑/↓ navigate · Enter run · Esc close · Tab fill");
    full.unmount();
    const empty = renderThemed(<CommandPalette query="zzz-nope" highlight={0} mru={[]} />);
    expect(frameText(empty.lastFrame)).toContain("No matching commands.");
    empty.unmount();
  });
});
