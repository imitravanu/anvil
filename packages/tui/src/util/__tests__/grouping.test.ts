import { describe, expect, it } from "vitest";
import { groupByProvider } from "../grouping.js";

interface FakeRow {
  providerId: string;
  id: string;
  isFree?: boolean;
}

const providerOf = (r: FakeRow) => r.providerId;
const isFreeOf = (r: FakeRow) => r.isFree;

describe("groupByProvider", () => {
  it("groups by provider in canonical order, not first-seen order", () => {
    const rows: FakeRow[] = [
      { providerId: "ollama", id: "o1" },
      { providerId: "anthropic", id: "a1" },
      { providerId: "ollama", id: "o2" },
    ];
    const sections = groupByProvider(rows, providerOf, isFreeOf);
    expect(sections.map((s) => s.providerId)).toEqual(["anthropic", "ollama"]);
    expect(sections[1].entries.map((e) => e.row.id)).toEqual(["o1", "o2"]);
    expect(sections[1].entries.map((e) => e.index)).toEqual([0, 2]);
  });

  it("keeps free models first inside each group, stably", () => {
    const rows: FakeRow[] = [
      { providerId: "groq", id: "paid1", isFree: false },
      { providerId: "groq", id: "free1", isFree: true },
      { providerId: "groq", id: "paid2", isFree: false },
      { providerId: "groq", id: "unknown" },
    ];
    const sections = groupByProvider(rows, providerOf, isFreeOf);
    expect(sections).toHaveLength(1);
    expect(sections[0].entries.map((e) => e.row.id)).toEqual([
      "free1",
      "paid1",
      "paid2",
      "unknown",
    ]);
  });

  it("trails unknown providers in first-seen order and handles empty input", () => {
    const rows: FakeRow[] = [
      { providerId: "zzz-new", id: "z1" },
      { providerId: "gemini", id: "g1" },
    ];
    const sections = groupByProvider(rows, providerOf, isFreeOf);
    expect(sections.map((s) => s.providerId)).toEqual(["gemini", "zzz-new"]);
    expect(groupByProvider([], providerOf, isFreeOf)).toEqual([]);
  });
});
