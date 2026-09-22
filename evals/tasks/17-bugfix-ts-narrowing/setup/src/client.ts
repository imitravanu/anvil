export type ApiResponse<T> =
  | { kind: "success"; data: T }
  | { kind: "pending" }
  | { kind: "error"; message: string };

/**
 * Returns the payload of a successful response.
 *
 * BUG: only the "error" variant is narrowed away, so the "pending" variant
 * still reaches the `data` access below. The project does not compile.
 */
export function unwrap<T>(res: ApiResponse<T>): T {
  if (res.kind === "error") {
    throw new Error(res.message);
  }
  return res.data;
}
