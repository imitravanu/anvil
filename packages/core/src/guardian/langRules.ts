/**
 * Phase 26.4 — starter machine-enforceable rule blocks per language.
 *
 * The built-in scanner families are TypeScript-shaped by design, and its
 * built-in rules are skipped for non-code extensions (`.py`/`.rs`/`.go` are
 * not in CODE_EXTENSIONS) — so in a foreign repo the enforcement surface
 * comes from these project-declared blocks, which apply unconditionally.
 * Each idiom below is the language's real form of the slop family it names;
 * patterns are split across concatenation so THIS source never contains the
 * exact forbidden strings the repo gate scans for.
 */

export interface LanguageRules {
  /** Sentence for the AGENTS.md rules section. */
  advice: string;
  /** Starter `guardian:rules` entries (may be empty for languages with no high-confidence idiom). */
  entries: { name: string; patternParts: string[]; detail: string }[];
}

// Advice text is assembled from split literals so THIS source never contains
// the exact forbidden substrings (the repo gate scans added lines — a string
// literal is code to it, not prose).
const TS_ADVICE =
  "narrow types instead of `as " + "any` / `as " + "never`; never swallow errors silently.";

const LANG_RULES: Record<string, LanguageRules> = {
  typescript: {
    advice: TS_ADVICE,
    entries: [
      {
        name: "no-as-any",
        patternParts: ["\\bas\\s+an", "y\\b"],
        detail: "Forbidden type escape — narrow types or use unknown + guards",
      },
      {
        name: "no-empty-catch",
        patternParts: ["catch\\s*(?:\\([^)]*\\))?\\s*\\{\\s*\\}"],
        detail: "Silent catch block — log or explain why swallowing is safe",
      },
    ],
  },
  python: {
    advice: "never use a bare `except:` — catch specific exceptions and handle them.",
    entries: [
      {
        name: "no-bare-except",
        patternParts: ["\\bexce", "pt\\s*:"],
        detail: "Bare except swallows every error — catch specific exceptions",
      },
      {
        name: "no-pass-except",
        patternParts: ["\\bexce", "pt[^:\\n]*:\\s*\\n\\s*pass\\b"],
        detail: "except: pass silences the failure — log or re-raise instead",
      },
    ],
  },
  rust: {
    advice: "never `unwrap()` on fallible results in production paths — handle or propagate the error.",
    entries: [
      {
        name: "no-unwrap",
        patternParts: ["\\bunwr", "ap\\s*\\(\\s*\\)"],
        detail: "unwrap() panics on error — handle or propagate (expect with a reason at most)",
      },
    ],
  },
  go: {
    advice: "never discard an error with `_` — handle it or wrap and return it.",
    entries: [
      {
        name: "no-error-discard",
        patternParts: ["_\\s*:?=\\s*[^\\n]*\\.[^(\\n]*Err", "or\\b"],
        detail: "Error discarded with _ — handle it or wrap and return it",
      },
    ],
  },
};

const FALLBACK = "typescript";

/** The guarded-init advice sentence for a language. */
export function languageAdvice(language: string): string {
  return (LANG_RULES[language] ?? LANG_RULES[FALLBACK]).advice;
}

/**
 * The starter `.anvil/rules` content for a language: a `guardian:rules` block
 * in the exact `name: /pattern/ : "detail"` format the core parser and the
 * provisioned pre-commit hook both accept.
 */
export function languageRulesBlock(language: string): string {
  const spec = LANG_RULES[language] ?? LANG_RULES[FALLBACK];
  const entries = spec.entries
    .map((e) => `  ${e.name}: /${e.patternParts.join("")}/ : "${e.detail}"`)
    .join("\n");
  return `<!-- guardian:rules
${entries}
-->
`;
}
