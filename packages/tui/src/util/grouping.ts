import { PROVIDER_LABELS } from "./labels.js";

/**
 * U9 picker grouping: group flat picker rows into provider sections.
 * Pure — ModelPicker keeps its flat navigation/selection logic and only
 * changes rendering. Section order is canonical (PROVIDER_LABELS key order),
 * unknown providers append in first-seen order. Within a group, free models
 * stay first (stable partition — registry relative order otherwise kept).
 */

export interface ProviderSection<T> {
  providerId: string;
  entries: { index: number; row: T }[];
}

const CANONICAL_ORDER = Object.keys(PROVIDER_LABELS);

export function groupByProvider<T>(
  rows: readonly T[],
  providerOf: (row: T) => string,
  isFreeOf: (row: T) => boolean | undefined
): ProviderSection<T>[] {
  const members = new Map<string, { index: number; row: T }[]>();
  for (let i = 0; i < rows.length; i++) {
    const pid = providerOf(rows[i]);
    const list = members.get(pid);
    if (list) list.push({ index: i, row: rows[i] });
    else members.set(pid, [{ index: i, row: rows[i] }]);
  }
  // Stable free-first inside each group.
  for (const list of members.values()) {
    list.sort((a, b) => Number(isFreeOf(b.row) === true) - Number(isFreeOf(a.row) === true));
  }
  const sections: ProviderSection<T>[] = [];
  for (const pid of CANONICAL_ORDER) {
    const entries = members.get(pid);
    if (entries) {
      sections.push({ providerId: pid, entries });
      members.delete(pid);
    }
  }
  // Unknown providers (not in the label map) trail in first-seen order.
  for (const [pid, entries] of members) sections.push({ providerId: pid, entries });
  return sections;
}
