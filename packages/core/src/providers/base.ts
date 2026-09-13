import { getErrorMessage } from "../errors.js";
import {
  CompletionRequest,
  ModelProvider,
  StreamEvent,
  ProviderId,
  ProviderErrorCode,
  classifyProviderError,
} from "./types.js";
import { ensureTurnEnd } from "./streaming.js";

export { classifyProviderError, type ProviderErrorCode };

/**
 * Base class for provider adapters. Eliminates duplicate boilerplate across
 * provider implementations. Subclasses implement `doStream`.
 */
export abstract class BaseProvider implements ModelProvider {
  abstract readonly id: ProviderId;
  abstract readonly displayName: string;

  abstract isConfigured(): boolean;

  async *streamCompletion(request: CompletionRequest): AsyncGenerator<StreamEvent> {
    if (!this.isConfigured()) {
      yield {
        type: "error",
        message: `${this.displayName} API key not configured.`,
        code: "AUTH_FAILED",
        isRetryable: false,
      };
      return;
    }

    const maxRetries = 2;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (request.signal?.aborted) {
        yield { type: "error", message: "Request was cancelled." };
        return;
      }
      try {
        const stream = await this.doStream(request);
        const iterator = ensureTurnEnd(stream)[Symbol.asyncIterator]();
        let first = await iterator.next();
        if (!first.done && first.value.type === "error") {
          const info = classifyProviderError(first.value.message);
          if (info.isRetryable && attempt < maxRetries && !request.signal?.aborted) {
            const delay = Math.min(50 * Math.pow(2, attempt), 2000);
            await new Promise((r) => setTimeout(r, delay));
            continue;
          }
        }
        while (!first.done) {
          yield first.value;
          first = await iterator.next();
        }
        return;
      } catch (err: unknown) {
        const info = classifyProviderError(err);
        if (info.isRetryable && attempt < maxRetries && !request.signal?.aborted) {
          const delay = Math.min(50 * Math.pow(2, attempt), 2000);
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }
        yield {
          type: "error",
          message: getErrorMessage(err),
          code: info.code,
          isRetryable: info.isRetryable,
          ...(info.httpStatus !== undefined ? { httpStatus: info.httpStatus } : {}),
        };
        return;
      }
    }
  }

  /**
   * Automatic retry with exponential backoff for transient failures (503/502/429/timeout).
   * Permanent errors (400, 401, 404, context overflow) fail immediately.
   */
  protected async streamWithRetry(
    request: CompletionRequest,
    maxRetries = 2
  ): Promise<AsyncGenerator<StreamEvent>> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (request.signal?.aborted) {
        throw new Error("Request was cancelled.");
      }
      try {
        return await this.doStream(request);
      } catch (err: unknown) {
        lastError = err;
        const info = classifyProviderError(err);
        if (!info.isRetryable || attempt === maxRetries || request.signal?.aborted) {
          throw err;
        }
        const delay = Math.min(1000 * Math.pow(2, attempt), 10_000);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
    throw lastError;
  }

  /** Subclass implements the actual streaming logic. */
  protected abstract doStream(
    request: CompletionRequest
  ): AsyncGenerator<StreamEvent> | Promise<AsyncGenerator<StreamEvent>>;
}