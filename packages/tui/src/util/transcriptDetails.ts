import type { ConversationMessage } from "@imitravanu/anvil-core";
import type { DisplayMessage } from "../hooks/eventReducer.js";

function json(value: unknown): string {
  try { return JSON.stringify(value, null, 2) ?? "(no data)"; }
  catch {
    // intentional: malformed display data must not prevent reviewing the rest.
    return "(unserializable retained data)";
  }
}

/** Never serialize image bytes or opaque provider metadata into a text view. */
export function transcriptDetails(messages: readonly DisplayMessage[], history: readonly ConversationMessage[]): string {
  const visible = messages.map(message => [
    message.role, message.text, message.errorText,
    message.reasoning ? `Retained reasoning:\n${message.reasoning}` : "",
    ...message.toolCalls.map(call => `${call.name}\n${json(call.input)}\n${json(call.output)}`),
    ...message.subAgents.map(agent => `Subagent: ${agent.task}\n${agent.report ?? "(no retained report)"}`),
  ].filter(Boolean).join("\n")).join("\n\n");
  const tools = history.flatMap(message => message.content.flatMap(part => {
    if (part.type === "tool_call") return [`${part.call.name}\n${json(part.call.input)}`];
    if (part.type === "tool_result") return [part.result.content];
    return [];
  })).join("\n\n");
  return `${visible}\n\nRetained session tool history (older content may have been compacted):\n${tools || "No tool history retained."}\n\nDisplay previews and session history have separate limits. Data absent from both cannot be recovered here.`;
}
