import { describe, expect, it } from "vitest";
import React from "react";
import type { SituationalContext } from "@anvil/core";
import { Header, headerSessionPlan } from "../Header.js";
import { frameText, renderThemed } from "../../test-utils/testRender.js";

/**
 * Phase 28.9 — session title + turn counter in the cockpit header.
 *
 * The harness cannot fake stdout columns (non-TTY by design), so the width
 * gates are asserted through the pure `headerSessionPlan` (the wordmarkMode
 * precedent). Render tests then pin what the harness width (80) actually
 * shows: the cockpit layout with the identity segments correctly hidden.
 */

const CONTEXT: SituationalContext = {
  projectRoot: "/tmp/anvil-demo",
  projectName: "anvil-demo",
  git: { branch: "main", clean: true, modifiedFiles: [] },
  ecosystem: { type: "node", packageManager: "npm", testScript: "npm test" },
  topLevelEntries: [],
  summary: "demo project",
};

describe("headerSessionPlan", () => {
  it("shows a named session in quotes from 92 columns", () => {
    expect(headerSessionPlan(92, "refactor auth", 3).showTitle).toBe(true);
    expect(headerSessionPlan(92, "refactor auth", 3).titleV).toBe('"refactor auth"');
    expect(headerSessionPlan(91, "refactor auth", 3).showTitle).toBe(false);
  });

  it("never renders empty quotes for unnamed sessions", () => {
    for (const unnamed of [null, undefined, "", "   "]) {
      const plan = headerSessionPlan(140, unnamed, 3);
      expect(plan.showTitle, `title ${String(unnamed)} must stay hidden`).toBe(false);
      expect(plan.titleV).toBe("");
    }
  });

  it("curtails long titles to the 24-cell budget inside the quotes", () => {
    const plan = headerSessionPlan(120, "a".repeat(60), 1);
    expect(plan.titleV.startsWith('"')).toBe(true);
    expect(plan.titleV.endsWith('"')).toBe(true);
    // curtail keeps the boundary visible; the quoted segment stays bounded.
    expect(plan.titleV.length).toBeLessThanOrEqual(27);
  });

  it("appends the turn count to the model tag from 105 columns", () => {
    expect(headerSessionPlan(105, null, 12).turnsSuffix).toBe(" · 12 turns");
    expect(headerSessionPlan(120, null, 1).turnsSuffix).toBe(" · 1 turn");
    expect(headerSessionPlan(104, null, 12).turnsSuffix).toBe("");
    expect(headerSessionPlan(120, null, undefined).turnsSuffix).toBe("");
  });

  it("treats turn zero as information, not noise: 0 turns is shown once counting starts", () => {
    expect(headerSessionPlan(120, null, 0).turnsSuffix).toBe(" · 0 turns");
  });
});

describe("Header render at the harness width (100 columns)", () => {
  it("shows the named session but keeps turns hidden below the 105-column gate", () => {
    // ink's test stdout is 100 columns: above the title gate (92), below the
    // turns gate (105) — exactly the boundary pair worth pinning.
    const { lastFrame, unmount } = renderThemed(
      <Header model="gpt-4o-mini" isBusy={false} context={CONTEXT} sessionTitle="refactor auth" turnCount={7} />
    );
    const out = frameText(lastFrame);
    expect(out).toContain("▲ ANVIL");
    expect(out).toContain("repo:");
    expect(out).toContain('"refactor auth"');
    expect(out).not.toContain("7 turns");
    unmount();
  });

  it("qualifies gpt-4o-mini by the session's provider (AUDIT-02)", () => {
    const gh = renderThemed(<Header model="gpt-4o-mini" providerId="github" isBusy={false} context={CONTEXT} />);
    const ghOut = frameText(gh.lastFrame);
    gh.unmount();
    expect(ghOut).toContain("GitHub");
    expect(ghOut).toContain("GPT-4o mini (via GitHub)");
    expect(ghOut).not.toContain("[PAID]");

    const oa = renderThemed(<Header model="gpt-4o-mini" providerId="openai" isBusy={false} context={CONTEXT} />);
    const oaOut = frameText(oa.lastFrame);
    oa.unmount();
    expect(oaOut).toContain("OpenAI");
    expect(oaOut).not.toContain("via GitHub");
  });

  it("renders the compact header without a context", () => {
    const { lastFrame, unmount } = renderThemed(
      <Header model="gpt-4o-mini" isBusy={false} sessionTitle="refactor auth" turnCount={7} />
    );
    const out = frameText(lastFrame);
    expect(out).toContain("▲ ANVIL");
    // Compact mode is the narrow-terminal layout: identity stays out.
    expect(out).not.toContain("refactor auth");
    expect(out).not.toContain('"');
    unmount();
  });
});
