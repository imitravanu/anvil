export type EventMap = Record<string, unknown>;
export type Listener<Payload> = (payload: Payload) => void;

/**
 * A type-safe event emitter keyed by an explicit event map.
 *
 * The signatures below already pin the public contract; the bodies still need
 * to be written.
 */
export class EventEmitter<Events extends EventMap> {
  on<K extends keyof Events>(event: K, listener: Listener<Events[K]>): void {
    throw new Error(`unimplemented: on(${String(event)})`);
  }

  off<K extends keyof Events>(event: K, listener: Listener<Events[K]>): void {
    throw new Error(`unimplemented: off(${String(event)})`);
  }

  once<K extends keyof Events>(event: K, listener: Listener<Events[K]>): void {
    throw new Error(`unimplemented: once(${String(event)})`);
  }

  emit<K extends keyof Events>(event: K, payload: Events[K]): void {
    throw new Error(`unimplemented: emit(${String(event)})`);
  }
}
