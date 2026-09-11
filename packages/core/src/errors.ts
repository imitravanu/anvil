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
