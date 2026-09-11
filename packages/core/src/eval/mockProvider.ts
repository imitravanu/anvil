import { ModelProvider, StreamEvent, CompletionRequest } from "../providers/types.js";
import { EvalTask } from "./types.js";
import fs from "node:fs";
import path from "node:path";

/**
 * Deterministic Mock Provider for offline evaluation and CI verification.
 * Automatically resolves expected changes from assertions/expected/ or task fixtures.
 */
export function createEvalMockProvider(task: EvalTask): ModelProvider {
  let turnCount = 0;
  return {
    id: "eval-mock" as any,
    displayName: "Anvil Eval Mock Provider",
    isConfigured: () => true,
    async *streamCompletion(request: CompletionRequest): AsyncGenerator<StreamEvent> {
      turnCount++;
      if (turnCount === 1) {
        yield { type: "text_delta", text: `[Mock Agent] Addressing task: ${task.name}...\n` };

        // Check if task has expected files in assertions/expected/
        const expectedDir = path.join(task.taskDir, "assertions", "expected");
        const expectedFiles: { relPath: string; content: string }[] = [];
        if (fs.existsSync(expectedDir)) {
          // Manual recursion: readdirSync's `recursive` option and
          // entry.parentPath are Node >=22.5 APIs, while the engines floor is
          // >=20 and CI runs Node 20 — guarded by not using them.
          const stack = [expectedDir];
          while (stack.length > 0) {
            const dir = stack.pop()!;
            for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
              const abs = path.join(dir, entry.name);
              if (entry.isDirectory()) {
                stack.push(abs);
              } else if (entry.isFile()) {
                expectedFiles.push({
                  relPath: path.relative(expectedDir, abs),
                  content: fs.readFileSync(abs, "utf8"),
                });
              }
            }
          }
          expectedFiles.sort((a, b) => a.relPath.localeCompare(b.relPath));
        }
        for (const { relPath, content } of expectedFiles) {
          const inputObj = { path: relPath, content };

          const callId = `call_${Math.random().toString(36).slice(2, 9)}`;
          yield {
            type: "tool_call_start",
            id: callId,
            name: "write_file",
          };
          yield {
            type: "tool_call_delta",
            id: callId,
            cumulativeInputJson: JSON.stringify(inputObj),
          };
          yield {
            type: "tool_call_end",
            id: callId,
            name: "write_file",
            input: inputObj,
          };
        }

        yield {
          type: "usage",
          inputTokens: 250,
          outputTokens: 75,
        };

        yield {
          type: "turn_end",
          stopReason: "tool_use",
        };
      } else {
        yield { type: "text_delta", text: "Successfully completed task." };
        yield {
          type: "usage",
          inputTokens: 300,
          outputTokens: 20,
        };
        yield {
          type: "turn_end",
          stopReason: "end_turn",
        };
      }
    },
  };
}
