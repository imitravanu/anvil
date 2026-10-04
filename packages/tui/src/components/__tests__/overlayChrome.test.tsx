import { describe, expect, it } from "vitest";
import { Header } from "../Header.js";
import { ModelPicker } from "../ModelPicker.js";
import { OverlayFrame } from "../OverlayFrame.js";
import { THEMES, type Theme } from "../../theme/theme.js";
import { sectionRule } from "../../util/chrome.js";
import { frameText, renderWithTheme, tick } from "../../test-utils/testRender.js";
import type { ModelProvider, ProviderId } from "@anvil/core";

/**
 * Phase 41 — the design tokens a theme DECLARES must reach the frame.
 *
 * Before this phase the whole chrome ignored them: every overlay hardcoded
 * `borderStyle="round"`, the header hardcoded "▲ ANVIL", and the section
 * dividers were literal `─`. A custom theme could set `borders.modal` or
 * `typography.brandIcon` and nothing changed — the tokens were validated,
 * documented, and dead. These tests only pass when the tokens are honored,
 * because each one renders under a theme whose token is DIFFERENT from the
 * built-in default.
 */

/** A theme with the given token overrides — everything else from dark. */
function themed(over: { border?: Theme["borders"]["modal"]; brandIcon?: string; brandName?: string; divider?: string }): Theme {
  return {
    ...THEMES.dark,
    borders: { ...THEMES.dark.borders, ...(over.border ? { modal: over.border } : {}) },
    typography: {
      ...THEMES.dark.typography,
      ...(over.brandIcon ? { brandIcon: over.brandIcon } : {}),
      ...(over.brandName ? { brandName: over.brandName } : {}),
      ...(over.divider ? { sectionDivider: over.divider } : {}),
    },
  };
}

const provider = (id: ProviderId, displayName: string): ModelProvider =>
  ({ id, displayName, isConfigured: () => false }) as unknown as ModelProvider;

describe("sectionRule", () => {
  it("repeats the theme divider to the requested width", () => {
    expect(sectionRule("═", 5)).toBe("═════");
    expect(sectionRule("─", 3)).toBe("───");
  });

  it("uses only the divider's first code point and clamps negatives to empty", () => {
    // A two-cell divider would double the rule's width and overflow the frame.
    expect(sectionRule("=+", 4)).toBe("====");
    expect(sectionRule("─", -2)).toBe("");
  });
});

describe("OverlayFrame — theme-driven modal chrome", () => {
  it("draws the theme's modal border, title, meta, hints, and section rule", () => {
    const { lastFrame, unmount } = renderWithTheme(
      themed({ border: "round", divider: "═" }),
      <OverlayFrame title="Select a model" meta="(1/2)" hints="Esc cancel">
        <></>
      </OverlayFrame>
    );
    const out = frameText(lastFrame);
    // round border box-drawing chars, not the default double set
    expect(out).toContain("╭");
    expect(out).toContain("╰");
    expect(out).not.toContain("╔");
    expect(out).toContain("Select a model");
    expect(out).toContain("(1/2)");
    expect(out).toContain("Esc cancel");
    expect(out).toContain("═");
    unmount();
  });

  it("falls back to the default double modal frame under the dark theme", () => {
    const { lastFrame, unmount } = renderWithTheme(
      THEMES.dark,
      <OverlayFrame title="Help">
        <></>
      </OverlayFrame>
    );
    const out = frameText(lastFrame);
    expect(out).toContain("╔");
    expect(out).toContain("Help");
    unmount();
  });
});

describe("Header — brand typography tokens", () => {
  it("renders the active theme's brandIcon and brandName", () => {
    const { lastFrame, unmount } = renderWithTheme(
      themed({ brandIcon: "◆", brandName: "NEON" }),
      <Header model="gpt-4o-mini" isBusy={false} />
    );
    const out = frameText(lastFrame);
    expect(out).toContain("◆ NEON");
    expect(out).not.toContain("▲ ANVIL");
    unmount();
  });

  it("keeps the built-in brand for the default theme", () => {
    const { lastFrame, unmount } = renderWithTheme(
      THEMES.dark,
      <Header model="gpt-4o-mini" isBusy={false} />
    );
    expect(frameText(lastFrame)).toContain("▲ ANVIL");
    unmount();
  });
});

describe("ModelPicker — adopts OverlayFrame chrome", () => {
  it("renders the titled modal with right-aligned hints and provider sections", () => {
    const { lastFrame, unmount } = renderWithTheme(
      themed({ divider: "═" }),
      <ModelPicker
        providers={
          {
            openrouter: provider("openrouter", "OpenRouter"),
            openai: provider("openai", "OpenAI"),
          } as unknown as Record<ProviderId, ModelProvider>
        }
        currentModelId=""
        onSelect={() => undefined}
        onClose={() => undefined}
      />
    );
    const out = frameText(lastFrame);
    expect(out).toContain("╔"); // modal frame, not the old panel border
    expect(out).toContain("Select a model");
    expect(out).toContain("═"); // section divider token
    expect(out).toContain("Esc cancel");
    unmount();
  });

  it("keeps a PASTED chunk in the type-to-filter box", async () => {
    // Ink delivers a paste as one multi-character `input`; the old
    // `input.length === 1` guard dropped it, so a pasted model id never
    // reached the filter (the same class of bug as the help filter).
    const app = renderWithTheme(
      THEMES.dark,
      <ModelPicker
        providers={
          {
            openrouter: provider("openrouter", "OpenRouter"),
            openai: provider("openai", "OpenAI"),
          } as unknown as Record<ProviderId, ModelProvider>
        }
        currentModelId=""
        onSelect={() => undefined}
        onClose={() => undefined}
      />
    );
    await tick();
    app.stdin.write("qwen"); // one chunk, four characters
    await tick();
    expect(frameText(app.lastFrame)).toContain("filter: qwen");
    app.unmount();
  });
});
