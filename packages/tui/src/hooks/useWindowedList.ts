import { useMemo } from "react";
import { MAX_VISIBLE_ROWS } from "../util/displayLimits.js";

/**
 * Centered scroll window shared by ModelPicker/SessionPicker (was duplicated
 * with drift risk). Returns the slice offset + edge flags.
 */
export function windowOffset(
  length: number,
  selected: number,
  maxVisible: number = MAX_VISIBLE_ROWS
): { offset: number; hasAbove: boolean; hasBelow: boolean } {
  if (length <= maxVisible) return { offset: 0, hasAbove: false, hasBelow: false };
  const half = Math.floor(maxVisible / 2);
  let offset = selected - half;
  if (offset < 0) offset = 0;
  if (offset + maxVisible > length) offset = length - maxVisible;
  return {
    offset,
    hasAbove: offset > 0,
    hasBelow: offset + maxVisible < length,
  };
}

export function useWindowedList(
  length: number,
  selected: number,
  maxVisible: number = MAX_VISIBLE_ROWS
): { offset: number; hasAbove: boolean; hasBelow: boolean } {
  return useMemo(() => windowOffset(length, selected, maxVisible), [length, selected, maxVisible]);
}
