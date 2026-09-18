import type { DiffRow } from "./parseDiff.js";

/**
 * DW-4.5 — side-by-side pairing over parsed unified rows. Deletion runs
 * followed by addition runs pair index-wise (changed-line alignment);
 * leftovers pair against blank; context pairs with itself; file/hunk/meta
 * rows are full-width banners. Pure and unit-tested.
 */

export type SideRow =
  | { kind: "banner"; text: string; tone: "file" | "hunk" | "meta" }
  | {
      kind: "pair";
      left: { text: string; lineNo: number | null; tone: "del" | "context" | "blank" };
      right: { text: string; lineNo: number | null; tone: "add" | "context" | "blank" };
    };

export function pairSideRows(rows: readonly DiffRow[]): SideRow[] {
  const out: SideRow[] = [];
  let i = 0;
  while (i < rows.length) {
    const row = rows[i];
    if (row.kind === "file") {
      out.push({ kind: "banner", text: row.text, tone: "file" });
      i++;
      continue;
    }
    if (row.kind === "hunk") {
      out.push({ kind: "banner", text: row.text, tone: "hunk" });
      i++;
      continue;
    }
    if (row.kind === "meta") {
      out.push({ kind: "banner", text: row.text, tone: "meta" });
      i++;
      continue;
    }
    if (row.kind === "context") {
      out.push({
        kind: "pair",
        left: { text: row.text, lineNo: row.oldNo, tone: "context" },
        right: { text: row.text, lineNo: row.newNo, tone: "context" },
      });
      i++;
      continue;
    }
    // Collect a del-run followed by its add-run; pair index-wise so a
    // changed line sits across from its replacement.
    if (row.kind === "del" || row.kind === "add") {
      const dels: Extract<DiffRow, { kind: "del" }>[] = [];
      const adds: Extract<DiffRow, { kind: "add" }>[] = [];
      while (i < rows.length && rows[i].kind === "del") {
        dels.push(rows[i] as Extract<DiffRow, { kind: "del" }>);
        i++;
      }
      while (i < rows.length && rows[i].kind === "add") {
        adds.push(rows[i] as Extract<DiffRow, { kind: "add" }>);
        i++;
      }
      const pairs = Math.max(dels.length, adds.length);
      for (let p = 0; p < pairs; p++) {
        const del = dels[p];
        const add = adds[p];
        out.push({
          kind: "pair",
          left:
            del !== undefined
              ? { text: del.text, lineNo: del.oldNo, tone: "del" }
              : { text: "", lineNo: null, tone: "blank" },
          right:
            add !== undefined
              ? { text: add.text, lineNo: add.newNo, tone: "add" }
              : { text: "", lineNo: null, tone: "blank" },
        });
      }
      continue;
    }
    i++;
  }
  return out;
}
