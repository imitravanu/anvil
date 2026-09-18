import { getErrorMessage, sleepAbortable } from "../errors.js";
import { PROVIDER_STREAM_MAX_RETRIES } from "../config/constants.js";
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

    const maxRetries = PROVIDER_STREAM_MAX_RETRIES;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (request.signal?.aborted) {
        yield { type: "error", message: "Request was cancelled." };
        return;
      }
      // Whether any event of the CURRENT attempt has been surfaced to the
      // consumer. Retry is only safe while nothing has been delivered —
      // restarting after delivered deltas would replay them.
      let surfaced = false;
      try {
        const stream = await this.doStream(request);
        const iterator = ensureTurnEnd(stream)[Symbol.asyncIterator]();
        let first = await iterator.next();
        if (!first.done && first.value.type === "error") {
          const info = classifyProviderError(first.value.message);
          if (info.isRetryable && attempt < maxRetries && !request.signal?.aborted) {
            // The underlying stream is still open after a mid-flight error
            // event — close the abandoned iterator before retrying.
            await iterator.return(undefined);
            const delay = Math.min(50 * Math.pow(2, attempt), 2000);
            await sleepAbortable(delay, request.signal);
            continue;
          }
        }
        while (!first.done) {
          surfaced = true;
          yield first.value;
          first = await iterator.next();
        }
        return;
      } catch (err: unknown) {
        if (request.signal?.aborted || getErrorMessage(err) === "aborted") {
          yield { type: "error", message: "Request was cancelled." };
          return;
        }
        const info = classifyProviderError(err);
        if (
          info.isRetryable &&
          attempt < maxRetries &&
          !request.signal?.aborted &&
          !surfaced
        ) {
          const delay = Math.min(50 * Math.pow(2, attempt), 2000);
          await sleepAbortable(delay, request.signal);
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

  /** Subclass implements the actual streaming logic. */
  protected abstract doStream(
    request: CompletionRequest
  ): AsyncGenerator<StreamEvent> | Promise<AsyncGenerator<StreamEvent>>;
}