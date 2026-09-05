import type { StreamEvent } from "./types.js";

// ---------------------------------------------------------------------------
// Shared stream plumbing the three translators hand-rolled the same
// buffering with three different bugs. Common invariants live here, once.
// ---------------------------------------------------------------------------

/**
 * Guarantee every turn ends with exactly one `turn_end` (unless the stream
 * errored — errors are terminal on their own). Adapters whose APIs don't
 * always send a stop marker (Anthropic without message_delta) wrap their
 * translator with this instead of each inventing a fallback.
 */
export async function* ensureTurnEnd(
  inner: AsyncIterable<StreamEvent>
): AsyncGenerator<StreamEvent> {
  let ended = false;
  let errored = false;
  for await (const event of inner) {
    if (event.type === "turn_end") ended = true;
    if (event.type === "error") errored = true;
    yield event;
  }
  if (!ended && !errored) yield { type: "turn_end", stopReason: "unknown" };
}

export interface AssembledCall {
  id: string;
  name: string;
  input: unknown;
}

/**
 * Buffers indexed incremental tool-call chunks (OpenAI chat-completions
 * shape) into complete calls. Documented semantics, enforced in one place:
 * - id is FROZEN at first sight (late duplicates ignored — a start/end id
 *   pair must never diverge for consumers keyed by id).
 * - tool_call_start is DEFERRED until the name is known (no nameless starts).
 * - args fragments APPEND; every delta carries the CUMULATIVE buffer.
 * - drain() emits ends in index order and clears state.
 */
export class ToolCallAssembler {
  private calls = new Map<number, { id: string; name: string; args: string; started: boolean }>();

  /**
   * Feed one chunk's tool-call part. Returns 0+ events (start and/or delta).
   * Chunks arriving before id+name are known only buffer args silently.
   */
  push(index: number, part: { id?: string; name?: string; argsFragment?: string }): StreamEvent[] {
    const events: StreamEvent[] = [];
    let entry = this.calls.get(index);
    if (!entry) {
      entry = { id: "", name: "", args: "", started: false };
      this.calls.set(index, entry);
    }
    if (!entry.id && part.id) entry.id = part.id;
    if (!entry.name && part.name) entry.name = part.name;
    if (!entry.started && entry.id && entry.name) {
      entry.started = true;
      events.push({ type: "tool_call_start", id: entry.id, name: entry.name });
    }
    if (part.argsFragment) {
      entry.args += part.argsFragment;
      // Deltas only make sense against an identified call.
      if (entry.started) {
        events.push({ type: "tool_call_delta", id: entry.id, cumulativeInputJson: entry.args });
      }
    }
    return events;
  }

  /** Emit tool_call_end for every buffered call in index order. */
  *drain(): Generator<StreamEvent> {
    const ordered = [...this.calls.entries()].sort((a, b) => a[0] - b[0]);
    this.calls.clear();
    for (const [index, entry] of ordered) {
      const id = entry.id || `call_${index}`;
      let parsed: unknown = {};
      try {
        parsed = entry.args.trim() ? JSON.parse(entry.args) : {};
      } catch {
        parsed = {}; // tool executor reports validation errors back to the model
      }
      yield { type: "tool_call_end", id, name: entry.name, input: parsed };
    }
  }

  get pending(): number {
    return this.calls.size;
  }
}
