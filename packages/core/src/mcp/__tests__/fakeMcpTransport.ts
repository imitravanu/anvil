import type { McpTransport } from "../transport.js";

/**
 * In-memory fake MCP transport (mirrors FakeProvider in agent/__tests__).
 * The handler answers methods; notifications (no id) get no reply.
 * `neverAnswer` simulates a hung server for timeout tests.
 */
export class FakeMcpTransport implements McpTransport {
  sent: { jsonrpc: string; id?: number | string; method: string; params: unknown }[] = [];
  private queue: string[] = [];
  private waiters: ((line: string | null) => void)[] = [];
  private ended = false;
  hangMethods = new Set<string>();

  constructor(
    private readonly handler: (method: string, params: unknown) => unknown
  ) {}

  send(msg: string): void {
    const parsed = JSON.parse(msg) as { id?: number | string; method: string; params: unknown };
    this.sent.push(
      parsed.id === undefined
        ? { jsonrpc: "2.0", method: parsed.method, params: parsed.params }
        : { jsonrpc: "2.0", id: parsed.id, method: parsed.method, params: parsed.params }
    );
    if (parsed.id === undefined) return; // notification — no reply
    if (this.hangMethods.has(parsed.method)) return; // hung server
    const reply = this.handler(parsed.method, parsed.params);
    this.emit(JSON.stringify({ jsonrpc: "2.0", id: parsed.id, result: reply }));
  }

  /** Inject a server-initiated line (notification, late or string-id response). */
  emit(line: string): void {
    const waiter = this.waiters.shift();
    if (waiter) waiter(line);
    else this.queue.push(line);
  }

  async *lines(): AsyncIterable<string> {
    while (true) {
      if (this.queue.length > 0) {
        yield this.queue.shift()!;
        continue;
      }
      if (this.ended) return;
      const line = await new Promise<string | null>((resolve) => {
        this.waiters.push(resolve);
      });
      if (line === null) return;
      yield line;
    }
  }

  methodsSeen(): string[] {
    return this.sent.map((s) => s.method);
  }

  close(): void {
    this.ended = true;
    for (const w of this.waiters.splice(0)) w(null);
  }
}
