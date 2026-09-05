// Phase 8 (A.1.2): canonical, provider-order-independent hash of a tool input.
// Providers do NOT emit tool-call arguments with stable key order, so a plain
// JSON.stringify would create false "different call" keys for identical inputs.
// Recursively sorts object keys before hashing. Returns a fixed 64-hex digest
// (never the input text — large inputs must not bloat loop state or ledger).
import { createHash } from "node:crypto";

function sortKeys(value: unknown, seen: WeakSet<object> = new WeakSet()): unknown {
  if (Array.isArray(value)) return value.map((v) => sortKeys(v, seen));
  if (value !== null && typeof value === "object") {
    // Guard against cycles and pass through non-plain objects: Dates, Buffers
    // and friends have no enumerable-arg relevance; structuredClone-style
    // traversal would misrepresent them.
    if (value instanceof Date || ArrayBuffer.isView(value) || value instanceof ArrayBuffer) {
      return value;
    }
    if (seen.has(value)) return "[Circular]";
    seen.add(value);
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = sortKeys((value as Record<string, unknown>)[key], seen);
    }
    return out;
  }
  return value;
}

export function canonicalInputHash(input: unknown): string {
  let canonical: string;
  try {
    canonical = JSON.stringify(sortKeys(input)) ?? String(input);
  } catch {
    canonical = String(input);
  }
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}