import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { saveSession } from "../store.js";
import { searchSessions, SESSION_SEARCH_MIN_QUERY_CHARS } from "../search.js";
import { StoredSession } from "../types.js";
import { MessageContent } from "../../providers/types.js";
import {
  SESSION_SEARCH_MAX_RESULTS,
  SESSION_SEARCH_MAX_SNIPPETS,
} from "../../config/constants.js";

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "anvil-search-"));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function write(id: string, title: string, updatedAt: string, history: MessageContent[][]): void {
  const stored: StoredSession = {
    metadata: {
      id,
      title,
      providerId: "anthropic",
      model: "claude-opus-5",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt,
    },
    history: history.map((content, i) => ({ role: i % 2 === 0 ? "user" : "assistant" as const, content })),
  };
  saveSession(stored, dir);
}

const text = (t: string): MessageContent[] => [{ type: "text", text: t }];

describe("searchSessions", () => {
  it("matches transcript text case-insensitively", () => {
    write("a1", "Refactor", "2026-01-02T00:00:00.000Z", [
      text("please rename the ParseConfig helper"),
      text("Done: PARSEconfig is now parseConfig"),
    ]);

    const matches = searchSessions("parseconfig", dir);

    expect(matches).toHaveLength(1);
    expect(matches[0]!.metadata.id).toBe("a1");
    expect(matches[0]!.matchCount).toBe(2);
    expect(matches[0]!.snippets.map((s) => s.role)).toEqual(["user", "assistant"]);
  });

  it("ignores tool_result dumps and other non-text blocks", () => {
    // The session only ever READ pricing.js. Matching the dump would make every
    // session that touched a file hit any query naming it — the whole point of
    // restricting search to text.
    write("a2", "Unrelated", "2026-01-02T00:00:00.000Z", [
      [
        { type: "text", text: "look at the invoice math" },
        {
          type: "tool_result",
          result: { toolCallId: "t1", content: "1\tconst total = pricing.js:42" },
        },
      ],
      [
        { type: "image", mediaType: "image/png", data: "cHJpY2luZy5qcw==" },
        { type: "tool_call", call: { id: "c1", name: "read_file", input: { path: "pricing.js" } } },
      ],
    ]);

    expect(searchSessions("pricing", dir)).toEqual([]);
    expect(searchSessions("invoice", dir)).toHaveLength(1);
  });

  it("matches a query that spans a line break in the stored text", () => {
    write("a3", "Multiline", "2026-01-02T00:00:00.000Z", [
      text("I will now run\n  git rebase\n  --interactive"),
    ]);

    expect(searchSessions("git rebase --interactive", dir)).toHaveLength(1);
  });

  it("reports a title-only match with no snippets", () => {
    write("a4", "Auth token refresh", "2026-01-02T00:00:00.000Z", [text("unrelated body")]);

    const matches = searchSessions("auth token", dir);

    expect(matches).toHaveLength(1);
    expect(matches[0]!.matchedTitle).toBe(true);
    expect(matches[0]!.matchCount).toBe(0);
    expect(matches[0]!.snippets).toEqual([]);
  });

  it("orders hits most-recently-updated first", () => {
    write("old", "older", "2026-01-01T00:00:00.000Z", [text("needle here")]);
    write("newest", "newer", "2026-03-01T00:00:00.000Z", [text("needle here")]);
    write("mid", "middle", "2026-02-01T00:00:00.000Z", [text("needle here")]);

    expect(searchSessions("needle", dir).map((m) => m.metadata.id)).toEqual([
      "newest",
      "mid",
      "old",
    ]);
  });

  it("caps snippets per session but still counts every matching message", () => {
    const history = Array.from({ length: SESSION_SEARCH_MAX_SNIPPETS + 2 }, () => text("needle"));

    write("a5", "Many hits", "2026-01-02T00:00:00.000Z", history);

    const matches = searchSessions("needle", dir);

    expect(matches[0]!.matchCount).toBe(SESSION_SEARCH_MAX_SNIPPETS + 2);
    expect(matches[0]!.snippets).toHaveLength(SESSION_SEARCH_MAX_SNIPPETS);
  });

  it("counts matching messages, not occurrences", () => {
    write("a6", "Repeats", "2026-01-02T00:00:00.000Z", [text("needle needle needle")]);

    expect(searchSessions("needle", dir)[0]!.matchCount).toBe(1);
  });

  it("caps the number of returned sessions at the most recent ones", () => {
    const total = SESSION_SEARCH_MAX_RESULTS + 5;
    for (let i = 0; i < total; i++) {
      // i=0 is the oldest; pad so lexicographic ISO order == numeric order.
      const day = String((i % 27) + 1).padStart(2, "0");
      write(`s${i}`, `session ${i}`, `2026-01-${day}T00:00:00.000Z`, [text("needle")]);
    }

    const matches = searchSessions("needle", dir);

    expect(matches).toHaveLength(SESSION_SEARCH_MAX_RESULTS);
  });

  it("windows a long message around the match, ellipsising the cut edges", () => {
    const body = `${"x".repeat(300)} the secret is 42 ${"y".repeat(300)}`;
    write("a7", "Long", "2026-01-02T00:00:00.000Z", [text(body)]);

    const [snippet] = searchSessions("the secret is 42", dir)[0]!.snippets;

    expect(snippet!.text).toContain("the secret is 42");
    expect(snippet!.text.startsWith("…")).toBe(true);
    expect(snippet!.text.endsWith("…")).toBe(true);
    expect(snippet!.text).not.toContain("x".repeat(300));
  });

  it("returns nothing for an empty or too-short query", () => {
    write("a8", "Anything", "2026-01-02T00:00:00.000Z", [text("a")]);

    expect(searchSessions("", dir)).toEqual([]);
    expect(searchSessions("   ", dir)).toEqual([]);
    expect(searchSessions("a".repeat(SESSION_SEARCH_MIN_QUERY_CHARS - 1), dir)).toEqual([]);
    expect(searchSessions("a", dir)).toEqual([]);
  });

  it("skips a corrupt session file instead of throwing", () => {
    write("good", "Good", "2026-01-02T00:00:00.000Z", [text("needle")]);
    fs.writeFileSync(path.join(dir, "broken.json"), "{not valid json", "utf-8");

    expect(() => searchSessions("needle", dir)).not.toThrow();
    expect(searchSessions("needle", dir).map((m) => m.metadata.id)).toEqual(["good"]);
  });

  it("returns an empty list for an empty sessions dir and for no hits", () => {
    expect(searchSessions("needle", dir)).toEqual([]);

    write("a9", "No hit", "2026-01-02T00:00:00.000Z", [text("something else entirely")]);

    expect(searchSessions("needle", dir)).toEqual([]);
  });
});
