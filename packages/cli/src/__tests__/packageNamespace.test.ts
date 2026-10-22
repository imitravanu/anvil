import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../../../..");
const read = (file: string) => JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));

describe("public npm namespace", () => {
  it.each(["core", "tui", "cli"])("publishes %s under the owner's public scope", name => {
    const manifest = read(`packages/${name}/package.json`);
    const lock = read("package-lock.json");
    expect(manifest.name).toBe(`@imitravanu/anvil-${name}`);
    expect(manifest.publishConfig).toEqual({ access: "public", registry: "https://registry.npmjs.org/" });
    expect(lock.packages[`packages/${name}`].name).toBe(manifest.name);
    expect(lock.packages[`packages/${name}`].version).toBe(manifest.version);
    expect(lock.packages[`node_modules/${manifest.name}`]).toEqual({ resolved: `packages/${name}`, link: true });
    expect(lock.packages[`node_modules/@anvil/${name}`]).toBeUndefined();
  });

  it("pins internal dependencies to the matching release", () => {
    const core = read("packages/core/package.json");
    const tui = read("packages/tui/package.json");
    const cli = read("packages/cli/package.json");
    expect(tui.dependencies[core.name]).toBe(core.version);
    expect(cli.devDependencies[core.name]).toBe(core.version);
    expect(cli.devDependencies[tui.name]).toBe(tui.version);
    expect([tui.version, cli.version]).toEqual([core.version, core.version]);
    expect(tui.dependencies["@anvil/core"]).toBeUndefined();
    expect(cli.bin).toEqual({ anvil: "bin/anvil.cjs" });
  });
});
