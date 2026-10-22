import { useState } from "react";
import { Box } from "ink";
import { describe, it, expect, vi } from "vitest";
import { TranscriptViewport } from "../TranscriptViewport.js";
import type { DisplayMessage } from "../../hooks/eventReducer.js";
import { frameText, renderThemed, tick } from "../../test-utils/testRender.js";

const seen = vi.hoisted(() => new Set<string>());
vi.mock("../MessageView.js", async () => {
  const { Text } = await import("ink");
  return { MessageView: ({ message }: { message: DisplayMessage }) => { seen.add(message.id); return <Text>{message.text}</Text>; } };
});

const message = (index: number, text = `message-${index}`): DisplayMessage => ({ id: String(index), role: "assistant", text, streaming: false, toolCalls: [], subAgents: [] });
type Api = { maximum: number; setOffset: (value: number) => void };
function Harness({ messages, api }: { messages: DisplayMessage[]; api: { current?: Api } }) {
  const [offset, setOffset] = useState(0);
  const [maximum, setMaximum] = useState(0);
  api.current = { maximum, setOffset };
  return <Box height={8}><TranscriptViewport messages={messages} expanded={false} offset={offset} onBounds={(max, position) => { setMaximum(max); setOffset(position); }} /></Box>;
}

describe("virtual transcript", () => {
  it("mounts a bounded window and reaches the oldest message without rendering all history", async () => {
    seen.clear(); const api: { current?: Api } = {};
    const messages = Array.from({ length: 1000 }, (_, index) => message(index));
    const app = renderThemed(<Harness messages={messages} api={api} />); await tick();
    expect(seen.size).toBeLessThan(30);
    expect(frameText(app.lastFrame)).toContain("message-999");
    api.current!.setOffset(api.current!.maximum); await tick();
    expect(frameText(app.lastFrame)).toContain("message-0");
    expect(seen.size).toBeLessThan(60);
    app.rerender(<Harness messages={[...messages, message(1000)]} api={api} />); await tick();
    expect(frameText(app.lastFrame)).toContain("message-0");
    app.rerender(<Harness messages={[...messages.slice(1), message(1000)]} api={api} />); await tick();
    expect(frameText(app.lastFrame)).toContain("message-1"); app.unmount();
  });
  it("keeps the same row visible when a tall answer grows below the reader", async () => {
    const api: { current?: Api } = {};
    const text = Array.from({ length: 60 }, (_, index) => `row-${index}`).join("\n");
    const app = renderThemed(<Harness messages={[message(0, text)]} api={api} />); await tick();
    api.current!.setOffset(30); await tick();
    expect(frameText(app.lastFrame)).toContain("row-22");
    app.rerender(<Harness messages={[message(0, `${text}\nnew output`)]} api={api} />); await tick();
    expect(frameText(app.lastFrame)).toContain("row-22"); app.unmount();
  });
});
