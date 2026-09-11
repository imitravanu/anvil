import { PermissionBroker } from "@anvil/core";

export interface PendingPermissionRequest {
  toolName: string;
  summary: string; // for edit_file this is the unified diff; for run_command, the command text
  resolve: (approved: boolean) => void;
}

type Listener = (req: PendingPermissionRequest | null) => void;

/**
 * Implements core's PermissionBroker, bridging pending permission requests
 * into React via a tiny pub-sub. "Always allow" is per TOOL NAME, for the
 * rest of this process only — never persisted.
 *
 * Requests are served FIFO through a queue: concurrent callers no longer
 * clobber each other (the second request used to overwrite `current`,
 * orphaning the first promise forever). The overlay shows the head only.
 *
 * Abort handling: when an AbortSignal is provided, the broker registers a
 * listener that rejects all pending and queued requests with `false`,
 * preventing stuck promises on cancellation.
 */
export class TuiPermissionBroker implements PermissionBroker {
  private listeners = new Set<Listener>();
  private current: PendingPermissionRequest | null = null;
  private queue: { toolName: string; summary: string; resolve: (approved: boolean) => void }[] = [];
  private alwaysApprove = new Set<string>(); // tool names approved for the rest of this session
  private abortHandlers = new Map<AbortSignal, () => void>();

  /** Register a listener; returns an unsubscribe function. Fires immediately with current state. */
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.current);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Attach an AbortSignal to the broker. When the signal fires, all pending
   * and queued permission requests are resolved with `false` (denied).
   * Safe to call once per turn with the turn's controller signal; each
   * distinct signal gets its own one-shot listener. Attaching an already-
   * aborted signal rejects pending requests immediately.
   */
  attachAbortSignal(signal: AbortSignal): void {
    if (signal.aborted) {
      this.rejectAllPending();
      return;
    }
    if (this.abortHandlers.has(signal)) return; // idempotent per signal
    const handler = () => {
      this.abortHandlers.delete(signal);
      this.rejectAllPending();
    };
    this.abortHandlers.set(signal, handler);
    signal.addEventListener("abort", handler, { once: true });
  }

  /** Detach the abort handler (e.g. on broker disposal). */
  detachAbortSignal(signal: AbortSignal): void {
    const handler = this.abortHandlers.get(signal);
    if (handler) {
      signal.removeEventListener("abort", handler);
      this.abortHandlers.delete(signal);
    }
  }

  private rejectAllPending(): void {
    // Drain the queue FIRST: current.resolve() triggers pump(), which would
    // otherwise promote a queued item into `current` and orphan its promise
    // when we null it below.
    const queued = this.queue.splice(0);
    if (this.current) {
      const cur = this.current;
      this.current = null;
      cur.resolve(false);
    }
    for (const req of queued) {
      req.resolve(false);
    }
    this.notify();
  }

  async requestPermission(toolName: string, summary: string): Promise<boolean> {
    if (this.alwaysApprove.has(toolName)) return true;
    return new Promise<boolean>((resolve) => {
      this.queue.push({ toolName, summary, resolve });
      this.pump();
    });
  }

  private pump(): void {
    if (this.current || this.queue.length === 0) return;
    const next = this.queue.shift()!;
    let resolved = false;
    this.current = {
      toolName: next.toolName,
      summary: next.summary,
      resolve: (approved: boolean) => {
        if (resolved) return;
        resolved = true;
        this.current = null;
        this.notify();
        next.resolve(approved);
        this.pump();
      },
    };
    this.notify();
  }

  approveAlwaysForSession(toolName: string): void {
    this.alwaysApprove.add(toolName);
  }

  /**
   * Drop all "always allow" grants. Called whenever the session identity
   * changes (/clear, /session new, resume, cross-provider model switch): a
   * grant given in one conversation must never silently auto-allow tools in
   * another.
   */
  clearSessionApprovals(): void {
    this.alwaysApprove.clear();
  }

  private notify(): void {
    for (const listener of this.listeners) listener(this.current);
  }
}