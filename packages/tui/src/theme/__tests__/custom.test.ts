import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadCustomThemes } from "../custom.js";
import { REQUIRED_COLOR_KEYS, THEMES } from "../themes.js";

describe("theme registry consistency", () => {
  it("REQUIRED_COLOR_KEYS covers every built-in color key exactly", () => {
    for (const theme of Object.values(THEMES)) {
      expect([...REQUIRED_COLOR_KEYS].sort()).toEqual(Object.keys(theme.colors).sort());
    }
  });
});

const COLORS = {
  primary: "cyan",
  userText: "white",
  assistantText: "green",
  toolName: "yellow",
  toolRunning: "yellow",
  toolDone: "green",
  toolError: "red",
  dim: "gray",
  border: "cyan",
  accent: "#ff00ff",
  surface: "gray",
};

describe("custom themes", () => {
  const saved = process.env.ANVIL_HOME;
  let tmp = "";
  afterEach(() => {
    if (saved === undefined) delete process.env.ANVIL_HOME;
    else process.env.ANVIL_HOME = saved;
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
    tmp = "";
  });

  function writeThemes(content: string): void {
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true }); // helper may run twice per test
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "anvil-theme-"));
    process.env.ANVIL_HOME = tmp;
    fs.writeFileSync(path.join(tmp, "themes.json"), content, "utf-8");
  }

  it("missing file loads empty, never throws", () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "anvil-theme-"));
    process.env.ANVIL_HOME = tmp;
    expect(loadCustomThemes()).toEqual({ themes: {}, problems: [] });
  });

  it("loads a valid theme (hex colors allowed, spacing defaulted)", () => {
    writeThemes(JSON.stringify({ solar: { colors: COLORS } }));
    const { themes, problems } = loadCustomThemes();
    expect(problems).toEqual([]);
    expect(themes.solar.colors.accent).toBe("#ff00ff");
    expect(themes.solar.spacing).toEqual({ panelPaddingX: 1, panelPaddingY: 0 });
  });

  it("reports every invalid entry and loads the valid ones", () => {
    writeThemes(
      JSON.stringify({
        ok: { colors: COLORS, spacing: { panelPaddingX: 2, panelPaddingY: 1 } },
        dark: { colors: COLORS },
        "Bad Name!": { colors: COLORS },
        nocols: {},
        partial: { colors: { primary: "red" } },
        badspace: { colors: COLORS, spacing: { panelPaddingX: -1 } },
      })
    );
    const { themes, problems } = loadCustomThemes();
    expect(Object.keys(themes)).toEqual(["ok"]);
    expect(themes.ok.spacing).toEqual({ panelPaddingX: 2, panelPaddingY: 1 });
    expect(problems.map((p) => p.name).sort()).toEqual(
      ["Bad Name!", "badspace", "dark", "nocols", "partial"].sort()
    );
    expect(problems.find((p) => p.name === "dark")!.error).toContain("shadows built-in");
    expect(problems.find((p) => p.name === "partial")!.error).toContain("userText");
  });

  it("corrupt JSON reports a problem, never throws", () => {
    writeThemes("nope{{{");
    const { themes, problems } = loadCustomThemes();
    expect(themes).toEqual({});
    expect(problems).toHaveLength(1);
    expect(problems[0].error).toContain("not valid JSON");
  });
});
