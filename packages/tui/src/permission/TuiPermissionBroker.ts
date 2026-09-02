import { PermissionBroker } from "@anvil/core";

export interface PendingPermissionRequest {
  toolName: string;
  summary: string; // for edit_file this is the unified diff; for run_command, the command text
  resolve: (approved: boolean) => void;
}

type Listener = (req: PendingPermissionRequest | null) => void;

/**
 * Implements core's PermissionBroker, bridging a pending permission request
 * into React via a tiny pub-sub. "Always allow" is per TOOL NAME, for the
 * rest of this process only — never persisted (Phase 6+ may revisit).
 */
export class TuiPermissionBroker implements PermissionBroker {
  private listeners = new Set<Listener>();
  private current: PendingPermissionRequest | null = null;
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
      this.current = {
        toolName,
        summary,
        resolve: (approved: boolean) => {
          this.current = null;
          this.notify();
          resolve(approved);
        },
      };
      this.notify();
    });
  }

  approveAlwaysForSession(toolName: string): void {
    this.alwaysApprove.add(toolName);
  }

  private notify(): void {
    for (const listener of this.listeners) listener(this.current);
  }
}