import { describe, expect, it } from "vitest";
import { canonicalInputHash } from "../canonical.js";

describe("canonicalInputHash", () => {
  it("is order-independent and fixed-length hex, never the input text", () => {
    const a = canonicalInputHash({ b: 1, a: { d: 2, c: 1 } });
    const b = canonicalInputHash({ a: { c: 1, d: 2 }, b: 1 });
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("differs across different inputs, including large ones", () => {
    const big1 = "x".repeat(600_000);
    expect(canonicalInputHash({ content: big1 }).length).toBe(64);
    expect(canonicalInputHash({ content: big1 })).not.toBe(canonicalInputHash({ content: big1 + "y" }));
    expect(canonicalInputHash({ a: 1 })).not.toBe(canonicalInputHash({ a: 2 }));
  });

  it("survives cycles and special objects without throwing", () => {
    const cyclic: Record<string, unknown> = { a: 1 };
    cyclic.self = cyclic;
    expect(canonicalInputHash(cyclic)).toMatch(/^[0-9a-f]{64}$/);
    expect(canonicalInputHash({ at: new Date(0) })).toMatch(/^[0-9a-f]{64}$/);
  });
});
