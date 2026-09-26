import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * AUDIT-11 conformance guard (constitution §2.4 — no scattered magic caps).
 *
 * Cap-shaped constants were found declared beside their consumers in 18
 * modules (35 names). They now live in exactly two central files — core's
 * config/constants.ts and the TUI's util/displayLimits.ts (its display-budget
 * equivalent; the TUI cannot import the numbers from core without dragging in
 * the engine). The defining modules re-export their names, so the public API
 * is unchanged — but a future cap must be declared HERE or it fails this test.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

const CENTRAL_FILES = [
  "packages/core/src/config/constants.ts",
  "packages/tui/src/util/displayLimits.ts",
];

/** Same shape the AUDIT-11 sweep used: a name that bounds a size, count, or time. */
const CAP_NAME_RE = /[A-Z_]*(?:MAX|CAP|LIMIT|BYTES|_MS|TIMEOUT|RETRIES|DEPTH|RECENT|KEEP)[A-Z_]*$/;
const EXPORTED_CONST_RE = /^\s*export const ([A-Z0-9_]+)\s*=/;

function* walkSources(dir: string): Generator<string> {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist" || entry.name === "__tests__") continue;
      yield* walkSources(full);
    } else if (/\.tsx?$/.test(entry.name) && !/\.(d|test)\.tsx?$/.test(entry.name)) {
      yield full;
    }
  }
}

describe("constants conformance (AUDIT-11)", () => {
  it("cap-shaped exported constants are declared only in the central files", () => {
    const offenders: { file: string; name: string }[] = [];
    const declared = new Map<string, string[]>();

    for (const file of walkSources(path.join(ROOT, "packages"))) {
      const rel = path.relative(ROOT, file).split(path.sep).join("/");
      const central = CENTRAL_FILES.includes(rel);
      const lines = fs.readFileSync(file, "utf-8").split("\n");
      for (const line of lines) {
        const match = EXPORTED_CONST_RE.exec(line);
        if (!match || !CAP_NAME_RE.test(match[1])) continue;
        if (central) {
          const sites = declared.get(match[1]) ?? [];
          sites.push(rel);
          declared.set(match[1], sites);
        } else {
          offenders.push({ file: rel, name: match[1] });
        }
      }
    }

    const duplicated = [...declared.entries()].filter(([, sites]) => sites.length > 1);
    expect(
      offenders.map((o) => `${o.file}: ${o.name}`),
      "cap-shaped constants must be declared in config/constants.ts (core) or util/displayLimits.ts (tui); move the value there and re-export it for API compatibility"
    ).toEqual([]);
    expect(
      duplicated.map(([name, sites]) => `${name}: ${sites.join(", ")}`),
      "a cap name must have exactly one central declaration"
    ).toEqual([]);
  });
});
