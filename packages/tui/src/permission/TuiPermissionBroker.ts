import { PermissionBroker } from "@anvil/core";
import { sanitizeTerminalText } from "../util/sanitize.js";

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
  private aborted = false;

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
      this.aborted = true;
      this.rejectAllPending();
      return;
    }
    // A fresh turn attaches a fresh signal — clear the previous turn's abort
    // latch so post-cancel turns can prompt again.
    this.aborted = false;
    if (this.abortHandlers.has(signal)) return; // idempotent per signal
    const handler = () => {
      this.abortHandlers.delete(signal);
      this.aborted = true;
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
    if (this.aborted) return false;
    return new Promise<boolean>((resolve) => {
      // F1/AUDIT-2026-09-30: the summary is model-authored; sanitize at this
      // handoff so every consent renderer consumes terminal-safe text — a
      // bare \r used to visually replace what the user believed they were
      // approving.
      this.queue.push({ toolName, summary: sanitizeTerminalText(summary), resolve });
      this.pump();
    });
  }

  private pump(): void {
    if (this.current || this.queue.length === 0) return;
    // Skip heads already granted always-allow while queued — the grant arrived
    // after enqueue and must not prompt.
    while (this.queue.length > 0 && this.alwaysApprove.has(this.queue[0].toolName)) {
      const granted = this.queue.shift()!;
      granted.resolve(true);
    }
    if (this.current || this.queue.length === 0) {
      this.notify();
      return;
    }
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
    // F9 (AUDIT-2026-09-30): the grant must also clear requests for the SAME
    // tool that are already waiting — the enqueue-time check meant a queued
    // prompt still interrupted the user after they chose "always allow".
    if (this.current?.toolName === toolName) {
      this.current.resolve(true);
      return;
    }
    const granted = this.queue.filter((q) => q.toolName === toolName);
    if (granted.length > 0) {
      this.queue = this.queue.filter((q) => q.toolName !== toolName);
      for (const q of granted) q.resolve(true);
      this.notify();
    }
  }

  /**
   * Drop all "always allow" grants. Called whenever the session identity
   * changes (/clear, /session new, resume, cross-provider model switch): a
   * grant given in one conversation must never silently auto-allow tools in
   * another.
   */
  clearSessionApprovals(): void {
    this.alwaysApprove.clear();
    this.aborted = false;
  }

  private notify(): void {
    for (const listener of this.listeners) listener(this.current);
  }
}