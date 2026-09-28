import { describe, expect, it } from "vitest";
import { parseFileAst } from "../parser.js";
import { definition } from "../../tools/findSymbol.js";
import type { AstSymbol, AstSymbolKind } from "../types.js";

/**
 * SYMBOL KIND CONTRACT GUARD
 *
 * The symbol index can hold any `AstSymbolKind`, and `find_symbol` tells the
 * model which kinds it may filter by. Those two lists drifting apart is a
 * silent-failure class this repo has already paid for once: `.go` files were
 * walked and indexed while no Go parser existed, so `find_symbol` returned
 * nothing for an entire advertised language, and Rust `impl`/`mod` symbols
 * could be produced and indexed but never filtered for. Both were found by
 * probing, not by a test.
 *
 * These assertions make the class mechanical: the advertised list is read from
 * the shipped tool definition (never a hardcoded copy), and the expected list is
 * compiler-enforced against the type union.
 */

/**
 * Every member of `AstSymbolKind`. Typing this as `Record<AstSymbolKind, true>`
 * means adding a kind to the union without adding it here is a TYPE ERROR — the
 * list cannot silently go stale the way a hand-maintained array would.
 */
const ALL_KINDS: Record<AstSymbolKind, true> = {
  function: true,
  method: true,
  class: true,
  interface: true,
  type: true,
  enum: true,
  variable: true,
  constant: true,
  struct: true,
  trait: true,
  impl: true,
  module: true,
};

/** The `kind` filter's advertised enum, read out of the tool the model is given. */
function advertisedKinds(): string[] {
  const schema = definition.inputSchema as {
    properties?: { kind?: { enum?: string[] } };
  };
  return schema.properties?.kind?.enum ?? [];
}

const TS = `
export interface Shape {
  area(): number;
}

export type Alias = Shape;

export enum Color {
  Red,
  Blue,
}

export class Circle implements Shape {
  public area(): number {
    return 1;
  }
}

export async function load(token: string): Promise<boolean> {
  return token.length > 0;
}

export const MAX = 10;
`;

const RS = `
pub struct Config {
    pub port: u16,
}

pub trait Service {
    fn run(&self);
}

pub enum Mode {
    Fast,
    Slow,
}

pub mod storage {
    pub fn open() -> bool {
        true
    }
}

impl Config {
    pub fn describe(&self) -> u16 {
        self.port
    }
}

pub type Outcome = std::result::Result<u16, String>;

pub const LIMIT: u16 = 8;
`;

const GO = `
package main

const MaxRetries = 3

var counter int

type Server struct {
	Host string
}

type Runner interface {
	Run() error
}

type Alias = Server

func NewServer() *Server {
	return &Server{}
}

func (s *Server) Start() error {
	return nil
}
`;

const PY = `
class Calculator:
    def add(self, x):
        return x

def standalone(val):
    return val
`;

/** Language fixtures chosen so that all twelve kinds appear at least once. */
const CORPUS: readonly [string, string][] = [
  ["fixture.ts", TS],
  ["fixture.rs", RS],
  ["fixture.go", GO],
  ["fixture.py", PY],
];

/** Every kind the parser actually produces across the corpus, children included. */
function producedKinds(): Set<string> {
  const kinds = new Set<string>();
  const walk = (symbols: AstSymbol[]): void => {
    for (const s of symbols) {
      kinds.add(s.kind);
      if (s.children) walk(s.children);
    }
  };
  for (const [file, source] of CORPUS) walk(parseFileAst(source, file).symbols);
  return kinds;
}

describe("symbol kind contract", () => {
  it("advertises exactly the kinds the symbol index can hold", () => {
    const advertised = new Set(advertisedKinds());
    const expected = new Set(Object.keys(ALL_KINDS));

    const missing = [...expected].filter((k) => !advertised.has(k));
    const extra = [...advertised].filter((k) => !expected.has(k));

    // A kind the index can hold but the filter omits is unfilterable: the model
    // has no way to ask for it even though find_symbol will return it.
    expect(missing, `find_symbol cannot filter by: ${missing.join(", ")}`).toEqual([]);
    // A kind the filter offers but the type union lacks would be unassignable.
    expect(extra, `advertised but not a real kind: ${extra.join(", ")}`).toEqual([]);
  });

  it("can actually produce every kind it advertises", () => {
    const produced = producedKinds();
    const unproducible = advertisedKinds().filter((kind) => !produced.has(kind));

    // This is the assertion that would have caught an entire language being
    // advertised, walked, indexed — and silently unplumbed.
    expect(
      unproducible,
      `advertised but no supported language's parser emits it: ${unproducible.join(", ")}`
    ).toEqual([]);
  });

  it("does not silently drop any declared kind", () => {
    const produced = producedKinds();
    const dropped = Object.keys(ALL_KINDS).filter((kind) => !produced.has(kind));
    expect(dropped, `parser emits no ${dropped.join(", ")} in the corpus`).toEqual([]);
  });
});
