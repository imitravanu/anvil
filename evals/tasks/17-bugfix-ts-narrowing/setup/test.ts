declare const console: { log: (...args: unknown[]) => void };

import { unwrap, type ApiResponse } from "./src/client";

function check(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function thrownMessage(thunk: () => unknown): string {
  try {
    thunk();
  } catch (err) {
    if (err instanceof Error) {
      return err.message;
    }
    return `<non-error thrown: ${String(err)}>`;
  }
  return "<nothing thrown>";
}

const success: ApiResponse<number> = { kind: "success", data: 7 };
check(unwrap(success) === 7, "unwrap() must return the payload of a success response");

const failure: ApiResponse<number> = { kind: "error", message: "boom" };
check(
  thrownMessage(() => unwrap(failure)) === "boom",
  `unwrap() must throw the server message, got ${thrownMessage(() => unwrap(failure))}`
);

const pending: ApiResponse<number> = { kind: "pending" };
check(
  thrownMessage(() => unwrap(pending)) === "response is pending",
  `unwrap() must reject pending responses, got ${thrownMessage(() => unwrap(pending))}`
);

console.log("client: ok");
