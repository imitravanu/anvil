import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  appendToMemory,
  buildSystemPromptWithMemory,
  loadProjectMemory,
  MAX_MEMORY_BYTES,
  MEMORY_RELATIVE_PATH,
} from "../memory.js";
import { buildSystemPrompt } from "../rules.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "anvil-memory-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("loadProjectMemory", () => {
  it("returns null when .anvil/memory.md does not exist", () => {
    expect(loadProjectMemory(tmpDir)).toBeNull();
  });

  it("returns null when .anvil/memory.md is empty or whitespace only", () => {
    const anvilDir = path.join(tmpDir, ".anvil");
    fs.mkdirSync(anvilDir, { recursive: true });
    fs.writeFileSync(path.join(anvilDir, "memory.md"), "   \n\n  ", "utf8");
    expect(loadProjectMemory(tmpDir)).toBeNull();
  });

  it("loads project memory when present", () => {
    appendToMemory(tmpDir, "Architectural finding: use fast parser for AST");
    const mem = loadProjectMemory(tmpDir);
    expect(mem).not.toBeNull();
    expect(mem?.path).toBe(MEMORY_RELATIVE_PATH);
    expect(mem?.content).toContain("Architectural finding: use fast parser for AST");
    expect(mem?.content).toContain("### [");
    expect(mem?.sizeBytes).toBeGreaterThan(0);
  });

  it("truncates memory when file exceeds MAX_MEMORY_BYTES (32KB)", () => {
    const anvilDir = path.join(tmpDir, ".anvil");
    fs.mkdirSync(anvilDir, { recursive: true });
    const huge = "A".repeat(MAX_MEMORY_BYTES + 500);
    fs.writeFileSync(path.join(anvilDir, "memory.md"), huge, "utf8");

    const mem = loadProjectMemory(tmpDir);
    expect(mem).not.toBeNull();
    expect(mem?.content).toContain("[memory truncated at 32KB]");
    expect(mem?.sizeBytes).toBe(huge.length);
  });

  it("keeps the NEWEST memory slice when file exceeds MAX_MEMORY_BYTES", () => {
    const anvilDir = path.join(tmpDir, ".anvil");
    fs.mkdirSync(anvilDir, { recursive: true });
    // Old filler fills the cap; the marker lives at the tail (newest). A
    // head-read would hide it; the tail-read must surface it.
    const filler = "O".repeat(MAX_MEMORY_BYTES);
    const marker = "NEWEST_MARKER_" + "Z".repeat(100);
    fs.writeFileSync(path.join(anvilDir, "memory.md"), filler + marker, "utf8");

    const mem = loadProjectMemory(tmpDir);
    expect(mem).not.toBeNull();
    expect(mem?.content).toContain("NEWEST_MARKER_");
    expect(mem?.content).toContain("[memory truncated at 32KB]");
  });
});

describe("appendToMemory", () => {
  it("auto-creates .anvil/ directory and .anvil/.gitignore containing memory.md", () => {
    appendToMemory(tmpDir, "Initial note");
    const gitignorePath = path.join(tmpDir, ".anvil", ".gitignore");
    expect(fs.existsSync(gitignorePath)).toBe(true);
    expect(fs.readFileSync(gitignorePath, "utf8")).toContain("memory.md");
  });

  it("appends multiple entries with distinct timestamp headers", () => {
    appendToMemory(tmpDir, "First note");
    appendToMemory(tmpDir, "Second note");

    const mem = loadProjectMemory(tmpDir);
    expect(mem?.content).toContain("First note");
    expect(mem?.content).toContain("Second note");
    // Should have 2 timestamp headers
    const matches = mem?.content.match(/### \[/g);
    expect(matches?.length).toBe(2);
  });

  it("drops the OLDEST entries when an append would exceed the cap", () => {
    const big = "B".repeat(MAX_MEMORY_BYTES / 2);
    appendToMemory(tmpDir, `FIRST_${big}`);
    appendToMemory(tmpDir, `SECOND_${big}`);
    appendToMemory(tmpDir, "THIRD_keepme");

    const mem = loadProjectMemory(tmpDir);
    expect(mem).not.toBeNull();
    expect(mem?.sizeBytes).toBeLessThanOrEqual(MAX_MEMORY_BYTES);
    expect(mem?.content).toContain("THIRD_keepme");
    expect(mem?.content).toContain("SECOND_");
    // The file never grows past the cap, so the oldest entry is gone.
    expect(mem?.content).not.toContain("FIRST_");
  });

  it("refuses an entry that alone exceeds the cap", () => {
    expect(() => appendToMemory(tmpDir, "X".repeat(MAX_MEMORY_BYTES + 10))).toThrow(
      new RegExp(`exceeds the ${MAX_MEMORY_BYTES}-byte cap`)
    );
    // Nothing was written (the throw happens before any file I/O).
    expect(fs.existsSync(path.join(tmpDir, ".anvil", "memory.md"))).toBe(false);
  });
});

describe("buildSystemPromptWithMemory", () => {
  it("leaves base prompt untouched if rules and memory are null", () => {
    const base = "Base system prompt.";
    expect(buildSystemPromptWithMemory(base, tmpDir, null, null)).toBe(base);
  });

  it("injects rules and memory in exact specified order", () => {
    const base = "You are Anvil.";
    const rules = { source: "AGENTS.md", content: "Always verify tests." };
    const memory = {
      path: ".anvil/memory.md",
      content: "### [2026-09-10]\nDiscovered that libX requires Node 22.",
      sizeBytes: 60,
    };

    const prompt = buildSystemPromptWithMemory(base, tmpDir, rules, memory);
    expect(prompt).toBe(
      "You are Anvil.\n\n" +
      "[Project-specific rules from AGENTS.md]\nAlways verify tests.\n\n" +
      "[Project memory from .anvil/memory.md]\n### [2026-09-10]\nDiscovered that libX requires Node 22."
    );
  });

  it("buildSystemPrompt integrates both rules and memory from disk", () => {
    fs.writeFileSync(path.join(tmpDir, "AGENTS.md"), "Keep functions under 50 lines.", "utf8");
    appendToMemory(tmpDir, "Database migrations run on port 5433");

    const prompt = buildSystemPrompt("Base prompt.", tmpDir);
    expect(prompt).toContain("[Project-specific rules from AGENTS.md]");
    expect(prompt).toContain("Keep functions under 50 lines.");
    expect(prompt).toContain("[Project memory from .anvil/memory.md]");
    expect(prompt).toContain("Database migrations run on port 5433");
  });
});
