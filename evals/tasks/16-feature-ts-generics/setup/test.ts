declare const console: { log: (...args: unknown[]) => void };

import { EventEmitter } from "./src/emitter";

type Events = { ping: number; pong: string };

function check(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const bus = new EventEmitter<Events>();

const seen: number[] = [];
bus.on("ping", (n) => seen.push(n));
bus.emit("ping", 1);
bus.emit("ping", 2);
check(seen.join(",") === "1,2", `on() payloads should be 1,2 but saw ${seen.join(",")}`);

let pongCalls = 0;
const onPong = (): void => {
  pongCalls += 1;
};
bus.on("pong", onPong);
bus.off("pong", onPong);
bus.emit("pong", "first");
check(pongCalls === 0, `off() should unsubscribe but the handler ran ${pongCalls} time(s)`);

let onceCalls = 0;
bus.once("ping", () => {
  onceCalls += 1;
});
bus.emit("ping", 3);
bus.emit("ping", 4);
check(onceCalls === 1, `once() should fire exactly once but fired ${onceCalls} time(s)`);

// The payload type is derived from the event map, so this must not compile.
// If the emitter widens to a permissive type this directive goes unused and
// the project fails to type-check.
// @ts-expect-error - "ping" carries a number, never a string
bus.emit("ping", "not-a-number");

console.log("emitter: ok");
