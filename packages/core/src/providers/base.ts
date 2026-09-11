import { CompletionRequest, ModelProvider, StreamEvent, ProviderId, ToolDefinition } from "./types.js";
import { ensureTurnEnd } from "./streaming.js";

/**
 * Base class for provider adapters. Eliminates duplicate boilerplate across
 * the 9 provider implementations. Subclasses only implement `doStream`.
 */
export abstract class BaseProvider implements ModelProvider {
  abstract readonly id: ProviderId;
  abstract readonly displayName: string;

  abstract isConfigured(): boolean;

  async *streamCompletion(request: CompletionRequest): AsyncGenerator<StreamEvent> {
    if (!this.isConfigured()) {
      yield { type: "error", message: `${this.displayName} API key not configured.` };
      return;
    }

    try {
      yield* ensureTurnEnd(await this.doStream(request));
    } catch (err) {
      yield { type: "error", message: err instanceof Error ? err.message : String(err) };
    }
  }

  /** Subclass implements the actual streaming logic. */
  protected abstract doStream(request: CompletionRequest): AsyncGenerator<StreamEvent> | Promise<AsyncGenerator<StreamEvent>>;

  /** Convert core ToolDefinition to provider-specific format. Override if needed. */
  protected toProviderTools(tools: ToolDefinition[]): unknown[] {
    return tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema,
    }));
  }

  /** Convert core messages to provider-specific format. Override if needed. */
  protected toProviderMessages(messages: CompletionRequest["messages"]): unknown[] {
    return messages;
  }
}