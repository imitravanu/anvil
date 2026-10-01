import { describe, expect, it } from "vitest";
import { COMMANDS } from "@anvil/tui";
import { buildHelpText } from "../help.js";

/**
 * G9 (AUDIT-2026-09-30): the `--help` slash-command line drifted to 15 of the
 * registry's 20 commands as a hand-maintained literal. The line is now derived
 * from COMMANDS; this guard keeps it honest both ways — a command added to the
 * registry must appear, and a name on the line must be a real command.
 */
describe("--help slash-command parity (G9)", () => {
  const helpLine = (): string =>
    buildHelpText("0.0.0-test")
      .split("\n")
      .find((l) => l.startsWith("Slash commands inside the app:")) ?? "";

  it("lists every registry command", () => {
    const line = helpLine();
    expect(line, "help text has no slash-command line").not.toBe("");
    for (const cmd of COMMANDS) {
      expect(line, `registry command /${cmd.name} missing from --help`).toContain(`/${cmd.name}`);
    }
  });

  it("lists nothing the registry does not define", () => {
    const listed = [...helpLine().matchAll(/\/([a-z]+)/g)].map((m) => m[1]);
    const registered = new Set(COMMANDS.map((c) => c.name));
    const unknown = listed.filter((name) => !registered.has(name));
    expect(unknown, `--help names commands that do not exist: ${unknown.join(", ")}`).toEqual([]);
    expect(listed.length).toBe(registered.size);
  });
});
