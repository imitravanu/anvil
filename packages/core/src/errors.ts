/**
 * Standard error utilities for Anvil.
 * Enforces Constitution Rule: NO Sequential Raw Error Formatting.
 */

function hasMessage(err: unknown): err is { message: string } {
  return (
    typeof err === "object" &&
    err !== null &&
    "message" in err &&
    typeof (err as { message: unknown }).message === "string"
  );
}

/**
 * Rejects with an AbortError-shaped Error when `signal` aborts before `ms` elapse.
 * Used for retry/backoff waits so cancellation is honored mid-wait. Without a
 * signal it behaves as a plain sleep.
 */
export function sleepAbortable(ms: number, signal?: AbortSignal): Promise<void> {
  if (!signal) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error("aborted"));
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error("aborted"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Safely extract an actionable error message string from an unknown caught error.
 * Handles Error instances, custom subclasses, strings, objects with a message field, and primitives.
 */
export function getErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  if (typeof err === "string") {
    return err;
  }
  if (hasMessage(err)) {
    return err.message;
  }
  return String(err);
}
