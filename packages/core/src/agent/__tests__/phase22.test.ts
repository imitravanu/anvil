import { describe, it, expect } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { toGeminiContents } from "../../providers/gemini.js";
import { executeTool } from "../../tools/index.js";
import { resolveProviderSelection } from "../../config/index.js";
import { toOpenAIMessages } from "../../providers/openai.js";
import { createGroqProvider } from "../../providers/groq.js";
import { analyzeWorkspace } from "../goal/awareness.js";
import { loadCheckpoints } from "../checkpointStore.js";
import type { ConversationMessage } from "../../providers/types.js";

describe("Phase 22 Bug Fix Suite", () => {
  describe("22.2 - Malformed Tool Call JSON", () => {
    it("executeTool returns isError for inputs with __parseError", async () => {
      const result = await executeTool("read_file", { __parseError: true, rawInput: '{"path": ' }, {
        projectRoot: process.cwd(),
        signal: new AbortController().signal,
      });
      expect(result.isError).toBe(true);
      expect((result.output as { error: string }).error).toContain("Malformed JSON");
      expect(result.summary).toContain("malformed JSON");
    });
  });

  describe("22.3 - Gemini Compaction Orphan Tool Result", () => {
    it("skips orphaned tool results instead of emitting unknown_tool", () => {
      const messages: ConversationMessage[] = [
        {
          role: "user",
          content: [
            {
              type: "tool_result",
              result: {
                toolCallId: "orphan_call_1",
                content: JSON.stringify({ success: true }),
                isError: false,
              },
            },
          ],
        },
      ];

      const contents = toGeminiContents(messages);
      const jsonStr = JSON.stringify(contents);
      expect(jsonStr).not.toContain("unknown_tool");
      expect(contents).toHaveLength(0);
    });
  });

  describe("22.4 - Free Model Pricing Heuristic", () => {
    it("correctly identifies zero pricing in varying representations", () => {
      const checkZero = (pricing: any): boolean => {
        const promptPrice = Number(pricing?.prompt);
        const completionPrice = Number(pricing?.completion);
        const hasPricing = pricing != null && typeof pricing === "object";
        return (
          hasPricing &&
          !isNaN(promptPrice) &&
          promptPrice === 0 &&
          !isNaN(completionPrice) &&
          completionPrice === 0
        );
      };

      expect(checkZero({ prompt: "0", completion: "0" })).toBe(true);
      expect(checkZero({ prompt: "0.0", completion: "0.00" })).toBe(true);
      expect(checkZero({ prompt: 0, completion: 0 })).toBe(true);
      expect(checkZero({ prompt: "0.001", completion: "0" })).toBe(false);
      expect(checkZero(undefined)).toBe(false);
    });
  });

  describe("22.5 - Goal Review Verdict Parsing", () => {
    it("accepts valid confirmations and rejects hedges", () => {
      const isSatisfied = (reviewVerdict: string): boolean => {
        const startsYes = /^YES\b/i.test(reviewVerdict);
        const isHedge = /^YES\s*[,]\s*(but|however|although|except|unfortunately)/i.test(reviewVerdict);
        return startsYes && !isHedge;
      };

      expect(isSatisfied("YES")).toBe(true);
      expect(isSatisfied("YES — criteria met")).toBe(true);
      expect(isSatisfied("YES.")).toBe(true);
      expect(isSatisfied("YES\n- all good")).toBe(true);
      expect(isSatisfied("YES, all requirements verified.")).toBe(true);
      expect(isSatisfied("NO — failed tests")).toBe(false);
      expect(isSatisfied("YES, but the tests failed")).toBe(false);
      expect(isSatisfied("YES, however there are errors")).toBe(false);
    });
  });

  describe("22.6 - Binary File Detection in read_file", () => {
    it("refuses to read files containing null bytes as text", async () => {
      const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "anvil-binary-test-"));
      try {
        const binPath = path.join(tmp, "test.bin");
        const buf = Buffer.from([0x68, 0x65, 0x6c, 0x6c, 0x6f, 0x00, 0x77, 0x6f]); // "hello\0wo"
        await fs.writeFile(binPath, buf);

        const result = await executeTool("read_file", { path: "test.bin" }, {
          projectRoot: tmp,
          signal: new AbortController().signal,
        });

        expect(result.isError).toBe(true);
        expect(result.summary).toContain("binary file");
        expect((result.output as { error: string }).error).toContain("Binary file detected");
      } finally {
        await fs.rm(tmp, { recursive: true, force: true });
      }
    });
  });

  describe("22.7 - Ollama Keyless Selection", () => {
    it("allows selecting ollama without API key", () => {
      const selection = resolveProviderSelection({
        flagProvider: "ollama",
        creds: {},
      });
      expect(selection).not.toBeNull();
      expect(selection?.providerId).toBe("ollama");
    });
  });

  describe("22.8 - Vision Filtering on Non-Vision Providers", () => {
    it("omits images when supportsVision is false in toOpenAIMessages", () => {
      const messages: ConversationMessage[] = [
        {
          role: "user",
          content: [
            { type: "text", text: "Look at this:" },
            { type: "image", mediaType: "image/png", data: "base64data" },
          ],
        },
      ];

      const out = toOpenAIMessages(messages, undefined, { supportsVision: false });
      const userMsg = out.find((m) => m.role === "user");
      expect(userMsg).toBeDefined();
      const parts = userMsg?.content as Array<{ type: string; text?: string; image_url?: unknown }>;
      expect(parts.some((p) => p.image_url !== undefined)).toBe(false);
      expect(parts.some((p) => p.text?.includes("does not support vision"))).toBe(true);
    });
  });

  describe("22.9 - Checkpoint Store Corrupt File Containment", () => {
    it("returns empty array and does not throw on corrupt json file", async () => {
      const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "anvil-corrupt-cp-"));
      try {
        await fs.writeFile(path.join(tmp, "sess1.json"), "{ corrupt json !!!");
        const res = loadCheckpoints("sess1", tmp);
        expect(res).toEqual([]);
      } finally {
        await fs.rm(tmp, { recursive: true, force: true });
      }
    });
  });

  describe("22.10 - analyzeWorkspace async readdir", () => {
    it("introspects workspace without throwing", async () => {
      const ctx = await analyzeWorkspace(process.cwd());
      expect(ctx.projectName).toBeDefined();
      expect(ctx.summary).toContain("Project:");
    });
  });
});
