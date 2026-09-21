import { describe, expect, it } from "vitest";
import { MarkdownView } from "../MarkdownView.js";
import { parseMarkdownText } from "../renderMarkdown.js";
import { displayWidth } from "../../util/format.js";
import { frameText, renderThemed, tick } from "../../test-utils/testRender.js";

/**
 * Cell width for table padding is measured with the shared `displayWidth`
 * authority, so the renderer and these assertions cannot drift apart.
 */
function separatorColumns(frame: string): number[] {
  return frame
    .split("\n")
    .filter((line) => line.includes("│"))
    .map((line) => displayWidth(line.slice(0, line.indexOf("│"))));
}

async function tableFrame(rows: string[]): Promise<string> {
  const md = ["| name | n |", "| --- | --- |", ...rows].join("\n");
  const app = renderThemed(<MarkdownView blocks={parseMarkdownText(md)} />);
  await tick();
  const frame = frameText(app.lastFrame);
  app.unmount();
  return frame;
}

describe("MarkdownView tables", () => {
  it("keeps the │ separators aligned when cells contain wide characters", async () => {
    // Regression: padding counted CODE POINTS, but "中文" occupies 4 terminal
    // cells — every wide cell came out one cell short per wide char, shearing
    // the separators. The local helper's comment claimed CJK/emoji safety while
    // guarding only against String#length (surrogate pairs), not cell width.
    const cols = separatorColumns(await tableFrame(["| 中文 | 1 |", "| ab | 22 |"]));
    expect(cols.length).toBeGreaterThanOrEqual(3); // header + the two rows
    expect(new Set(cols).size).toBe(1);
  });

  it("keeps the separators aligned for emoji cells too", async () => {
    const cols = separatorColumns(await tableFrame(["| 🧪 | yes |", "| plain | no |"]));
    expect(cols.length).toBeGreaterThanOrEqual(3);
    expect(new Set(cols).size).toBe(1);
  });
});
