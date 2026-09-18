import { describe, expect, it, vi } from "vitest";
import { findLastCodeBlock, handleCopy } from "../clipboard.js";
import type { CommandHandlerDeps } from "../../types.js";
import type { DisplayMessage } from "../../../hooks/useAgentController.js";

function message(role: DisplayMessage["role"], text: string): DisplayMessage {
  return { id: `${role}-${text.length}`, role, text, streaming: false, toolCalls: [], subAgents: [] };
}

describe("findLastCodeBlock", () => {
  it("returns null with no fenced blocks", () => {
    expect(findLastCodeBlock([message("user", "hello")])).toBeNull();
    expect(findLastCodeBlock([])).toBeNull();
  });

  it("prefers the newest assistant block over newer user blocks", () => {
    const messages = [
      message("assistant", "first:\n```ts\nconst a = 1;\n```"),
      message("user", "later:\n```\nplain\n```"),
    ];
    expect(findLastCodeBlock(messages)).toEqual({ language: "ts", code: "const a = 1;" });
  });

  it("takes the newest block among assistants", () => {
    const messages = [
      message("assistant", "```js\nold();\n```"),
      message("assistant", "```py\nnew()\n```"),
    ];
    expect(findLastCodeBlock(messages)).toEqual({ language: "py", code: "new()" });
  });
});

describe("handleCopy", () => {
  it("reports when there is nothing to copy", () => {
    const printSystemMessage = vi.fn();
    handleCopy({ messages: [], printSystemMessage } as unknown as CommandHandlerDeps);
    expect(printSystemMessage).toHaveBeenCalledWith(
      expect.stringContaining("Nothing to copy")
    );
  });
});
