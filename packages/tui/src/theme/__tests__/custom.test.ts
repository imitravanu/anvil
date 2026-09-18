import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadCustomThemes } from "../custom.js";
import {
  REQUIRED_COLOR_KEYS,
  SEMANTIC_COLOR_KEYS,
  SEMANTIC_DERIVATION,
  THEMES,
} from "../themes.js";

describe("theme registry consistency", () => {
  it("built-ins carry every legacy key plus every derived semantic key", () => {
    for (const theme of Object.values(THEMES)) {
      for (const k of REQUIRED_COLOR_KEYS) expect(theme.colors[k]).toBeTruthy();
      for (const k of SEMANTIC_COLOR_KEYS) expect(theme.colors[k]).toBeTruthy();
    }
  });

  it("semantic derivation map covers every semantic key with a legacy source", () => {
    expect(Object.keys(SEMANTIC_DERIVATION).sort()).toEqual([...SEMANTIC_COLOR_KEYS].sort());
    for (const source of Object.values(SEMANTIC_DERIVATION)) {
      expect(REQUIRED_COLOR_KEYS).toContain(source);
    }
  });

  it("all five built-in themes exist", () => {
    expect(Object.keys(THEMES).sort()).toEqual(
      ["dark", "hacker", "highContrast", "light", "midnight"].sort()
    );
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

  it("loads a valid theme (hex colors allowed, DW-1 sections defaulted + derived)", () => {
    writeThemes(JSON.stringify({ solar: { colors: COLORS } }));
    const { themes, problems } = loadCustomThemes();
    expect(problems).toEqual([]);
    expect(themes.solar.colors.accent).toBe("#ff00ff");
    // Old 11-key files auto-migrate: semantics derive, sections default.
    expect(themes.solar.colors.brand).toBe("cyan");
    expect(themes.solar.colors.success).toBe("green");
    expect(themes.solar.colors.separator).toBe("gray");
    expect(themes.solar.spacing).toEqual({
      panelPaddingX: 1,
      panelPaddingY: 0,
      cardPaddingX: 2,
      cardGap: 1,
      sectionGap: 1,
    });
    expect(themes.solar.typography.brandIcon).toBe("▲");
    expect(themes.solar.borders.panel).toBe("round");
    expect(themes.solar.responsive.normalWidth).toBe(120);
  });

  it("honors semantic color overrides and custom sections", () => {
    writeThemes(
      JSON.stringify({
        neon: {
          colors: { ...COLORS, brand: "#00ff00", error: "#ff0000" },
          spacing: { cardPaddingX: 4 },
          typography: { brandIcon: "◆" },
          borders: { panel: "double" },
          responsive: { compactWidth: 70 },
        },
      })
    );
    const { themes, problems } = loadCustomThemes();
    expect(problems).toEqual([]);
    expect(themes.neon.colors.brand).toBe("#00ff00");
    expect(themes.neon.colors.error).toBe("#ff0000");
    expect(themes.neon.colors.success).toBe("green");
    expect(themes.neon.spacing.cardPaddingX).toBe(4);
    expect(themes.neon.spacing.panelPaddingX).toBe(1);
    expect(themes.neon.typography.brandIcon).toBe("◆");
    expect(themes.neon.typography.brandName).toBe("ANVIL");
    expect(themes.neon.borders.panel).toBe("double");
    expect(themes.neon.responsive.compactWidth).toBe(70);
    expect(themes.neon.responsive.normalWidth).toBe(120);
  });

  it("rejects bad semantic overrides and bad sections", () => {
    writeThemes(
      JSON.stringify({
        badcolor: { colors: { ...COLORS, brand: "" } },
        badtyp: { colors: COLORS, typography: { brandIcon: "" } },
        badbord: { colors: COLORS, borders: { panel: "groovy" } },
        badresp: { colors: COLORS, responsive: { compactWidth: 0 } },
      })
    );
    const { themes, problems } = loadCustomThemes();
    expect(themes).toEqual({});
    expect(problems).toHaveLength(4);
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
    expect(themes.ok.spacing).toEqual({
      panelPaddingX: 2,
      panelPaddingY: 1,
      cardPaddingX: 2,
      cardGap: 1,
      sectionGap: 1,
    });
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
