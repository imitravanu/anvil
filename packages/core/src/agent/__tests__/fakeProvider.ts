import { CompletionRequest, ModelProvider, StreamEvent } from "../../providers/types.js";

/**
 * One scripted turn: either a fixed event list, or a function that receives
 * the CompletionRequest (including its AbortSignal) and produces the events —
 * used for cancellation scenarios where the stream must react to abort.
 */
export type ScriptEntry =
  | StreamEvent[]
  | ((request: CompletionRequest) => AsyncGenerator<StreamEvent>);

export class FakeProvider implements ModelProvider {
  // The id must satisfy the ProviderId union even though this is a test fake.
  readonly id = "anthropic" as const;
  readonly displayName = "Fake Provider";

  calls: CompletionRequest[] = [];
  private script: ScriptEntry[];

  constructor(script: ScriptEntry[]) {
    this.script = [...script];
  }

  isConfigured(): boolean {
    return true;
  }

  async *streamCompletion(request: CompletionRequest): AsyncGenerator<StreamEvent> {
    this.calls.push(request);
    const entry = this.script.shift();
    if (entry === undefined) throw new Error("FakeProvider: script exhausted");
    if (typeof entry === "function") {
      yield* entry(request);
      return;
    }
    yield* entry;
  }
}

/**
 * A stream that emits one event then stalls until its AbortSignal fires —
 * simulating a long-running model response cut off by session.cancel().
 * It then returns cleanly (no turn_end), exactly like an aborted HTTP stream.
 */
export function stalledStream(
  signal: AbortSignal,
  first: StreamEvent
): AsyncGenerator<StreamEvent> {
  return (async function* () {
    yield first;
    await new Promise<void>((resolve) => {
      if (signal.aborted) {
        resolve();
      } else {
        signal.addEventListener("abort", () => resolve(), { once: true });
      }
    });
    return;
  })();
}
