// Phase 8 (A.1.2): canonical, provider-order-independent hash of a tool input.
// Providers do NOT emit tool-call arguments with stable key order, so a plain
// JSON.stringify would create false "different call" keys for identical inputs.
// Recursively sorts object keys before stringifying.

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = sortKeys((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

export function canonicalInputHash(input: unknown): string {
  try {
    return JSON.stringify(sortKeys(input));
  } catch {
    return String(input);
  }
}