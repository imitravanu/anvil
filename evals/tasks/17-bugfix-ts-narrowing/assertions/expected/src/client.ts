export type ApiResponse<T> =
  | { kind: "success"; data: T }
  | { kind: "pending" }
  | { kind: "error"; message: string };

/**
 * Returns the payload of a successful response and rejects every other variant.
 *
 * The switch is exhaustive over the discriminated union, so control flow never
 * reaches the end of the function and no `data` access is possible on a variant
 * that has no payload.
 */
export function unwrap<T>(res: ApiResponse<T>): T {
  switch (res.kind) {
    case "success":
      return res.data;
    case "pending":
      throw new Error("response is pending");
    case "error":
      throw new Error(res.message);
  }
}
