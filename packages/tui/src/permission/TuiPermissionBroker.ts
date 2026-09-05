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
 * rest of this process only — never persisted (Phase 6+ may revisit).
 *
 * Requests are served FIFO through a queue: concurrent callers no longer
 * clobber each other (the second request used to overwrite `current`,
 * orphaning the first promise forever). The overlay shows the head only.
 */
export class TuiPermissionBroker implements PermissionBroker {
  private listeners = new Set<Listener>();
  private current: PendingPermissionRequest | null = null;
  private queue: { toolName: string; summary: string; resolve: (approved: boolean) => void }[] = [];
  private alwaysApprove = new Set<string>(); // tool names approved for the rest of this session

  /** Register a listener; returns an unsubscribe function. Fires immediately with current state. */
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.current);
    return () => {
      this.listeners.delete(listener);
    };
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
    this.current = {
      toolName: next.toolName,
      summary: next.summary,
      resolve: (approved: boolean) => {
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

  private notify(): void {
    for (const listener of this.listeners) listener(this.current);
  }
}