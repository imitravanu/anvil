import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CORE_VERSION, TOOL_DEFINITIONS, createProviders, MODEL_REGISTRY, visibleModels, MAX_READ_FILE_BYTES, MAX_STREAM_BYTES, RUN_COMMAND_TIMEOUT_MS } from "@anvil/core";

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
        const source = fs.readFileSync(full, "utf-8");
        // Three access styles core really uses. A single process.env.X regex
        // silently missed the other two, so a documented var read only via a
        // helper looked "never read" (AUDIT-13).
        const patterns = [
          /process\.env\.([A-Z][A-Z0-9_]*)/g,
          /process\.env\[\s*["']([A-Z][A-Z0-9_]*)["']\s*\]/g,
          /\bgetEnv[A-Za-z]*\(\s*["']([A-Z][A-Z0-9_]*)["']/g,
        ];
        for (const pattern of patterns) {
          for (const m of source.matchAll(pattern)) names.add(m[1]!);
        }
      }
    }
  };
  walk(path.join(ROOT, "packages/core/src"));
  return names;
}

/** Source of a file in the TUI package, for deriving claims from code. */
const readTui = (rel: string): string => read(path.join("packages/tui/src", rel));

/** Command names registered in the TUI command registry (the `/` commands). */
function registryCommands(): string[] {
  return [...readTui("commands/registry.ts").matchAll(/^ {4}name: "([a-z]+)",$/gm)].map((m) => m[1]!);
}

/** Built-in theme names, from the `THEMES` record keys. */
function builtinThemeNames(): string[] {
  return [...readTui("theme/themes.ts").matchAll(/^ {2}([A-Za-z]+): makeTheme\(/gm)].map((m) => m[1]!);
}

/** Image extensions the `/image` handler accepts, from its media-type map. */
function mediaExtensions(): string[] {
  return [...readTui("commands/handlers/media.ts").matchAll(/"(\.[a-z0-9]+)": "image\//g)].map(
    (m) => m[1]!.slice(1)
  );
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
    const readme = read("README.md");
    expect(readme).toContain(`${TOOL_DEFINITIONS.length} autonomous tools`);
    // The architecture box states the same number in different words, and it is
    // the copy that drifted (it read "15 Built-in Tools" while the registry had
    // 16). The box's provider count was already guarded; this closes the same
    // hole for tools rather than fixing one instance and waiting for the next.
    expect(readme).toContain(`${TOOL_DEFINITIONS.length} Built-in Tools`);
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

  it("the README slash-command table documents exactly the command registry", () => {
    const section = read("README.md").split("## ⌨️ Slash Commands")[1] ?? "";
    const table = section.split(/^---$/m)[0] ?? "";
    const documented = [...table.matchAll(/^\| `\/([a-z]+)/gm)].map((m) => m[1]!);
    expect(documented.length, "the README command table looks empty").toBeGreaterThan(0);

    // Parity both ways, like the provider table: a command added without a row
    // ships invisible to users, and a stale row documents a command that no
    // longer exists. (7 of 20 commands were missing when this was written.)
    const registered = registryCommands();
    const missing = registered.filter((c) => !documented.includes(c));
    const stale = documented.filter((c) => !registered.includes(c));
    expect(missing, `registry commands the README omits: ${missing.join(", ")}`).toEqual([]);
    expect(stale, `README rows for commands that no longer exist: ${stale.join(", ")}`).toEqual([]);
  });

  it("the README size-cap paragraph matches the centralized constants", () => {
    const readme = read("README.md");
    expect(readme).toContain(`${MAX_READ_FILE_BYTES / 1024} KiB`);
    expect(readme).toContain(`${MAX_STREAM_BYTES / 1024} KiB`);
    expect(readme).toContain(`${RUN_COMMAND_TIMEOUT_MS / 60_000}-minute`);
    // The override knobs are part of the claim: a reader tuning a cap must find
    // the same names the constants module actually reads.
    for (const envName of ["ANVIL_MAX_READ_BYTES", "ANVIL_MAX_STREAM_BYTES", "ANVIL_RUN_COMMAND_TIMEOUT_MS"]) {
      expect(readme).toContain(envName);
    }
  });

  it("the README /theme row lists exactly the built-in themes", () => {
    const themes = builtinThemeNames();
    expect(themes.length).toBeGreaterThanOrEqual(5);
    const row = read("README.md").split("\n").find((l) => l.includes("/theme"));
    if (!row) expect.fail("no /theme row in the README");
    for (const t of themes) {
      expect(row, `README /theme row omits built-in theme ${t}`).toContain(t);
    }
    // Reverse parity: a backticked single word in the row must be a real theme,
    // so a renamed or deleted theme cannot leave a stale name behind. Tokens
    // with spaces are command syntax like `/theme <name>`, not theme names.
    const tokens = [...row.matchAll(/`([^`]+)`/g)]
      .map((m) => m[1]!)
      .filter((t) => !t.includes(" ") && t !== "custom");
    const stale = tokens.filter((t) => !themes.some((th) => th === t));
    expect(stale, `README /theme row names non-existent themes: ${stale.join(", ")}`).toEqual([]);
  });

  it("the README /image row lists every format the media handler accepts", () => {
    const extensions = mediaExtensions();
    expect(extensions.length).toBeGreaterThanOrEqual(3);
    const row = read("README.md").split("\n").find((l) => l.includes("/image"));
    if (!row) expect.fail("no /image row in the README");
    // `gif` was accepted by the handler but absent from the README.
    for (const ext of extensions) {
      expect(row, `README /image row omits .${ext}`).toContain(ext);
    }
    // Reverse parity: a backticked single word in the row must be a format the
    // handler still accepts, so dropping a format from code cannot leave the
    // README advertising it.
    const tokens = [...row.matchAll(/`([^`]+)`/g)]
      .map((m) => m[1]!)
      .filter((t) => !t.includes(" "));
    const stale = tokens.filter((t) => !extensions.includes(t));
    expect(stale, `README /image row advertises unsupported formats: ${stale.join(", ")}`).toEqual([]);
  });

  it("the TUI capability pill derives its tool count instead of hardcoding it", () => {
    const source = readTui("components/MessageList.tsx");
    expect(source).toContain("TOOL_DEFINITIONS.length");
    // A literal count here drifts exactly the way the README's "15 Built-in
    // Tools" did; the pill must render the registry's number.
    expect(source).not.toMatch(/◈ \d+ tools/);
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

  it("README model-picker count matches the free-visible registry", () => {
    const readme = read("README.md");
    // Both numbers are derived from code, so the README's picker description
    // can only fail this when the registry grows and the prose is not updated.
    expect(readme).toContain(`${visibleModels().length} free-visible models`);
    expect(readme).toContain(`${MODEL_REGISTRY.length} registered`);
  });

  it("the superseded complete-roadmap header names a live successor", () => {
    const header = read("docs/ANVIL-COMPLETE-ROADMAP.md").split(/^---$/m)[0] ?? "";
    // A frozen guide must SAY it is frozen and point at the guide that is not.
    expect(header).toMatch(/SUPERSEDED/);
    // First docs/ path in the banner is the successor it points readers to.
    const successor = header.split("docs/")[1]?.split(/[^A-Za-z0-9_.-]/)[0];
    expect(successor, "the banner must name a successor doc under docs/").toBeDefined();
    expect(fs.existsSync(path.join(ROOT, "docs", successor!))).toBe(true);
  });

  it("the docs index links only to files that exist on disk", () => {
    const index = read("docs/README.md");
    // In-docs links only: the ../ entries point at the repo root, not this folder.
    const links = [...index.matchAll(/\]\((?!\.\.\/|https?:)([^)#]+)\)/g)].map((m) => m[1]!);
    expect(links.length).toBeGreaterThan(0);
    for (const rel of links) {
      expect(
        fs.existsSync(path.join(ROOT, "docs", rel)),
        `docs index links a missing file: ${rel}`
      ).toBe(true);
    }
  });

  it("never calls a finished doc 'Current work' in the docs index", () => {
    // The index is the first thing an agent reads, so a stale "Current work"
    // pointer sends it to re-open completed work — the drift this guard exists
    // to stop (it happened: the completed hardening plan was still labelled
    // current while Phase 28 was the actual active phase).
    const currentRows = read("docs/README.md")
      .split("\n")
      .filter((line) => line.includes("**Current work**"));
    expect(currentRows.length).toBeGreaterThan(0);
    for (const row of currentRows) {
      const rel = /\]\(([^)#]+)\)/.exec(row)?.[1];
      expect(rel, `a Current-work row has no link: ${row}`).toBeDefined();
      const body = read(path.join("docs", rel!));
      expect(
        /\*\*Status:\*\*\s*COMPLETE/.test(body),
        `${rel} is called Current work but reports COMPLETE`
      ).toBe(false);
    }
  });
});
