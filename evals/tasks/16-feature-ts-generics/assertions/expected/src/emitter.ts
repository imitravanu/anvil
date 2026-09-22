export type EventMap = Record<string, unknown>;
export type Listener<Payload> = (payload: Payload) => void;

/**
 * A type-safe event emitter keyed by an explicit event map.
 *
 * Listeners are stored with an erased payload type: the public signatures are
 * the only way in or out and they already tie each key to its own payload, so
 * `never` is the widest parameter that accepts every concrete listener without
 * an escape hatch.
 */
export class EventEmitter<Events extends EventMap> {
  private readonly buckets = new Map<keyof Events, Set<Listener<never>>>();

  private bucket<K extends keyof Events>(event: K): Set<Listener<never>> {
    let set = this.buckets.get(event);
    if (!set) {
      set = new Set<Listener<never>>();
      this.buckets.set(event, set);
    }
    return set;
  }

  on<K extends keyof Events>(event: K, listener: Listener<Events[K]>): void {
    this.bucket(event).add(listener);
  }

  off<K extends keyof Events>(event: K, listener: Listener<Events[K]>): void {
    this.bucket(event).delete(listener);
  }

  once<K extends keyof Events>(event: K, listener: Listener<Events[K]>): void {
    let wrapped: Listener<Events[K]>;
    wrapped = (payload) => {
      this.off(event, wrapped);
      listener(payload);
    };
    this.on(event, wrapped);
  }

  emit<K extends keyof Events>(event: K, payload: Events[K]): void {
    // Snapshot the bucket so a listener that unsubscribes during dispatch (as
    // `once` does) cannot disturb the iteration in progress.
    for (const listener of Array.from(this.bucket(event))) {
      // A bucket only ever holds listeners registered for this exact key, so
      // restoring the erased parameter to the concrete one is sound here.
      (listener as Listener<Events[K]>)(payload);
    }
  }
}
