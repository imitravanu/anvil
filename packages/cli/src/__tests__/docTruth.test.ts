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

/**
 * The certified table's rows: `| **Name** | \`ENV_VAR\` | … |`. Derived from the
 * README so the expected values below come from code, not from the doc.
 */
function certifiedRows(): { name: string; envVars: string[] }[] {
  const section = read("README.md").split("## 📡 Supported Providers & Certified Models")[1] ?? "";
  const table = section.split(/^---$/m)[0] ?? "";
  return table
    .split("\n")
    .filter((line) => line.startsWith("| **"))
    .map((line) => {
      const cells = line.split("|").map((c) => c.trim());
      return {
        name: (cells[1] ?? "").replace(/\*\*/g, ""),
        envVars: [...(cells[2] ?? "").matchAll(/`([A-Z][A-Z0-9_]*)`/g)].map((m) => m[1]!),
      };
    });
}

/** Every env var name `packages/core/src` actually reads (tests excluded). */
function coreEnvVars(): Set<string> {
  const names = new Set<string>();
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "__tests__" || entry.name === "node_modules") continue;
        walk(full);
      } else if (entry.name.endsWith(".ts")) {
        for (const m of fs.readFileSync(full, "utf-8").matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)) {
          names.add(m[1]!);
        }
      }
    }
  };
  walk(path.join(ROOT, "packages/core/src"));
  return names;
}

// "Ollama (Local)" is the runtime label; the README's provider column is the
// product name. Normalize the parenthetical rather than loosen the match.
const productName = (displayName: string): string =>
  displayName.replace(/\s*\([^)]*\)\s*$/, "").trim();

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

  it("the certified-provider table lists exactly the registry's providers", () => {
    const rows = certifiedRows();
    const providers = Object.values(createProviders({}));
    // Parity both ways: a provider added without a row, or a stale row left
    // behind after a provider is removed, both fail here.
    expect(rows.length).toBe(providers.length);
    const documented = new Set(rows.map((r) => r.name));
    for (const provider of providers) {
      expect(documented, `README table is missing a row for ${provider.id}`).toContain(
        productName(provider.displayName)
      );
    }
  });

  it("every env var the certified table names is one core actually reads", () => {
    // Catches a renamed or invented variable — the README told users to export
    // a name the credential loader never consults. (Ollama's row says
    // "None / OLLAMA_HOST", so only its backticked name is asserted.)
    const known = coreEnvVars();
    const documented = certifiedRows().flatMap((r) => r.envVars);
    expect(documented.length).toBeGreaterThan(0);
    for (const name of documented) {
      expect(known, `README documents ${name}, which core never reads`).toContain(name);
    }
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
