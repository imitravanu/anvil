/**
 * U5 word-level highlighting: within a paired del/add line, mark exactly the
 * changed words so the eye lands on the edit, not the whole line.
 * Pure, no React. LCS on word tokens; whitespace is never marked changed.
 */

import type { DiffRow } from "./parseDiff.js";

export interface WordSeg {
  text: string;
  changed: boolean;
}

function tokenize(line: string): string[] {
  return line.split(/(\s+)/).filter((t) => t.length > 0);
}

function isSpace(tok: string): boolean {
  return /^\s+$/.test(tok);
}

/** LCS table over two token lists (content tokens only). */
function lcsTable(a: string[], b: string[]): number[][] {
  const dp: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0)
  );
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      dp[i][j] =
        a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  return dp;
}

/** Diff one del/add line pair into changed/unchanged word segments. */
export function diffWords(delLine: string, addLine: string): { del: WordSeg[]; add: WordSeg[] } {
  const a = tokenize(delLine);
  const b = tokenize(addLine);
  const aContent = a.filter((t) => !isSpace(t));
  const bContent = b.filter((t) => !isSpace(t));
  const dp = lcsTable(aContent, bContent);

  // Walk back through content tokens to find the LCS membership.
  const aKeep = new Array<boolean>(aContent.length).fill(false);
  const bKeep = new Array<boolean>(bContent.length).fill(false);
  let i = 0;
  let j = 0;
  while (i < aContent.length && j < bContent.length) {
    if (aContent[i] === bContent[j]) {
      aKeep[i] = true;
      bKeep[j] = true;
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      i++;
    } else {
      j++;
    }
  }

  const toSegs = (toks: string[], keep: boolean[]): WordSeg[] => {
    const segs: WordSeg[] = [];
    let ci = 0;
    for (const tok of toks) {
      if (isSpace(tok)) {
        segs.push({ text: tok, changed: false });
      } else {
        segs.push({ text: tok, changed: !keep[ci] });
        ci++;
      }
    }
    return segs;
  };
  return { del: toSegs(a, aKeep), add: toSegs(b, bKeep) };
}

/**
 * Pair adjacent del/add runs (a del block immediately followed by an add
 * block) line-by-line for word diffing. Unpaired lines come back fully
 * changed. Returns a map from row index → segments for add/del rows.
 */
export function pairRows(
  rows: readonly DiffRow[],
  textOf: (row: DiffRow) => string
): Map<number, WordSeg[]> {
  const out = new Map<number, WordSeg[]>();
  let k = 0;
  while (k < rows.length) {
    if (rows[k].kind !== "del") {
      k++;
      continue;
    }
    const delIdx: number[] = [];
    while (k < rows.length && rows[k].kind === "del") {
      delIdx.push(k);
      k++;
    }
    const addIdx: number[] = [];
    while (k < rows.length && rows[k].kind === "add") {
      addIdx.push(k);
      k++;
    }
    const paired = Math.min(delIdx.length, addIdx.length);
    for (let p = 0; p < paired; p++) {
      const { del, add } = diffWords(textOf(rows[delIdx[p]]), textOf(rows[addIdx[p]]));
      out.set(delIdx[p], del);
      out.set(addIdx[p], add);
    }
    const allChanged = (idx: number): WordSeg[] =>
      tokenize(textOf(rows[idx])).map((text) => ({ text, changed: true }));
    for (let p = paired; p < delIdx.length; p++) out.set(delIdx[p], allChanged(delIdx[p]));
    for (let p = paired; p < addIdx.length; p++) out.set(addIdx[p], allChanged(addIdx[p]));
  }
  return out;
}
