import { describe, expect, it } from "vitest";
import { toAnthropicMessages } from "../../providers/anthropic.js";
import { toOpenAIMessages } from "../../providers/openai.js";
import { toGeminiContents } from "../../providers/gemini.js";
import type { ConversationMessage } from "../../providers/types.js";

const PNG_RED_1X1 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function imageTurn(text: string): ConversationMessage {
  return {
    role: "user",
    content: [
      { type: "image", mediaType: "image/png", data: PNG_RED_1X1 },
      { type: "text", text },
    ],
  };
}

describe("vision message mapping", () => {
  it("anthropic: image part becomes a base64 source block before the text", () => {
    const out = toAnthropicMessages([imageTurn("what is this?")]);
    expect(out[0].role).toBe("user");
    const content = out[0].content as Array<{ type: string }>;
    expect(content[0].type).toBe("image");
    expect(content[1].type).toBe("text");
    const img = content[0] as unknown as { source: { type: string; media_type: string; data: string } };
    expect(img.source).toEqual({ type: "base64", media_type: "image/png", data: PNG_RED_1X1 });
  });

  it("openai: image turn becomes a content-part array with a data URL", () => {
    const out = toOpenAIMessages([imageTurn("what is this?")]) as Array<{
      role: string;
      content: Array<{ type: string; image_url?: { url: string }; text?: string }>;
    }>;
    expect(out[0].role).toBe("user");
    expect(Array.isArray(out[0].content)).toBe(true);
    expect(out[0].content[0].type).toBe("text");
    expect(out[0].content[1].type).toBe("image_url");
    expect(out[0].content[1].image_url?.url).toBe(`data:image/png;base64,${PNG_RED_1X1}`);
  });

  it("openai: plain turns keep string content (no gratuitous parts array)", () => {
    const out = toOpenAIMessages([{ role: "user", content: [{ type: "text", text: "plain" }] }]);
    expect(out[0].content).toBe("plain");
  });

  it("gemini: image part becomes inline_data with the mime type", () => {
    const contents = toGeminiContents([imageTurn("what is this?")]);
    const parts = contents[0].parts as Array<{
      text?: string;
      inlineData?: { mimeType: string; data: string };
    }>;
    expect(parts[0].inlineData).toEqual({ mimeType: "image/png", data: PNG_RED_1X1 });
    expect(parts[1].text).toBe("what is this?");
  });
});
