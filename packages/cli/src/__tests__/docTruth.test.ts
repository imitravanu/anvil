import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CORE_VERSION, TOOL_DEFINITIONS, createProviders } from "@anvil/core";

/**
 * DOC TRUTH GUARD
 *
 * Docs claiming things code no longer says is a recurring, low-glamour defect
 * class: a stale release badge, a provider count that stopped matching, a
 * roadmap header that still reports work as open after it landed. Fixing each
 * instance is whack-a-mole; these assertions make the class mechanical. Every
 * check derives its expected value FROM CODE, so it can only fail when the doc
 * drifts — never by its own staleness.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../");
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), "utf-8");

describe("doc truth", () => {
  it("README release badge matches the shipped core version", () => {
    const badge = read("README.md").match(/Release-v(\d+\.\d+\.\d+)/)?.[1];
    expect(badge, "README must carry a Release-vX.Y.Z badge").toBeDefined();
    expect(badge).toBe(CORE_VERSION);
  });

  it("README provider count matches the registry", () => {
    const readme = read("README.md");
    const count = Object.keys(createProviders({})).length;
    expect(readme).toContain(`${count} LLM providers`);
    expect(readme).toContain(`Provider Adapters (${count})`);
  });

  it("README tool count matches the tool registry", () => {
    expect(read("README.md")).toContain(`${TOOL_DEFINITIONS.length} autonomous tools`);
  });

  it("README Node badge matches package.json engines", () => {
    const engines = (JSON.parse(read("package.json")) as { engines?: { node?: string } }).engines;
    const min = engines?.node?.replace(/^>=\s*/, "");
    expect(min, "root package.json must declare engines.node").toBeDefined();
    expect(read("README.md")).toContain(`Node-%3E%3D${min}`);
  });

  it("the stabilization roadmap header agrees with its own checkboxes", () => {
    const roadmap = read("docs/STABILIZATION-ROADMAP-2026-09.md");
    const unchecked = (roadmap.match(/^\s*-\s\[ \]/gm) ?? []).length;
    // The status header is the first prose block, before the first divider.
    const header = roadmap.split(/^---$/m)[0] ?? "";
    // Bidirectional guard: claiming COMPLETE while a box is open, or leaving the
    // "COMPLETE" claim off after the last box is ticked, both fail here.
    expect(header.includes("COMPLETE")).toBe(unchecked === 0);
  });
});
