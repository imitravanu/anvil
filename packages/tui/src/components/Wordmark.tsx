import React, { useEffect, useRef, useState } from "react";
import { Box, Text, useInput } from "ink";
import {
  WORDMARK_ANIM_DURATION_MS,
  WORDMARK_ANIM_FRAME_MS,
  WORDMARK_COOL_DURATION_MS,
  WORDMARK_LETTER_START_MS,
  WORDMARK_RADIAL_CELL_MS,
  WORDMARK_SPARK_DELAY_MS,
} from "@anvil/core";
import { useTheme } from "../theme/theme.js";

/**
 * Animated pixel wordmark (Phase 28.5), ported from the anvil-ui-demo prototype.
 * 30 columns x 10 pixel rows, drawn as 5 half-block rows (`▀▄█`) so a pixel of
 * vertical resolution is gained for free.
 *
 * One deliberate change from the prototype: its heat ramp was hardcoded forge
 * colours. Here the ramp is the ACTIVE THEME's, so every theme gets its own
 * ignition look and the gate's no-hardcoded-colours rule is respected by
 * construction rather than by exception.
 */
const WORDMARK: readonly string[] = [
  "............................##",
  "........................##..##",
  "........................##..##",
  "............................##",
  ".####...#####...##..##..##..##",
  "....##..######..##..##..##..##",
  ".#####..##..##..##..##..##..##",
  "##..##..##..##...####...##..##",
  "##..##..##..##...####...##..##",
  ".#####..##..##....##....##..##",
];

export const WORDMARK_COLS = 30;
export const WORDMARK_ROWS = 5;

/** The dot of the "i": the ignition origin, and the one pixel that stays lit. */
const DOT_X = [24, 25];
const DOT_Y = [1, 2];

function isDot(x: number, y: number): boolean {
  return DOT_X.includes(x) && DOT_Y.includes(y);
}

/** Milliseconds until the pixel at (x, y) ignites — a radial wave from the dot. */
function arrival(x: number, y: number): number {
  return WORDMARK_LETTER_START_MS + WORDMARK_RADIAL_CELL_MS * Math.hypot(x - 24.5, y - 1.5);
}

/** 1 = fresh off the wave front, 0 = fully cooled to the ramp's base. */
function heatK(t: number, x: number, y: number): number {
  return Math.max(0, 1 - (t - arrival(x, y)) / WORDMARK_COOL_DURATION_MS);
}

function parseHex(color: string): [number, number, number] | null {
  const m = /^#([0-9a-fA-F]{6})$/.exec(color);
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * Sample a heat ramp at `k` ∈ [0, 1], blending between stops. A non-hex stop (a
 * custom theme may legitimately use a named colour like `green`) makes the blend
 * impossible, so the nearest stop is used instead — a flat ramp step, never a
 * broken render or a parse crash.
 */
export function heatAt(k: number, ramp: readonly string[]): string {
  if (k <= 0) return ramp[0];
  if (k >= 1) return ramp[ramp.length - 1];
  const scaled = k * (ramp.length - 1);
  const i = Math.floor(scaled);
  const f = scaled - i;
  const a = parseHex(ramp[i]);
  const b = parseHex(ramp[i + 1]);
  if (!a || !b) return ramp[i];
  const mixed = a.map((v, c) => Math.round(v + (b[c] - v) * f));
  return `#${mixed.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

function pixelColor(t: number, x: number, y: number, ramp: readonly string[], flash: string): string | null {
  if (WORDMARK[y][x] !== "#") return null;
  if (isDot(x, y)) {
    if (t < WORDMARK_SPARK_DELAY_MS) return null;
    if (t < WORDMARK_LETTER_START_MS) return flash;
    // The dot never cools: it is the brand mark the wordmark settles around.
    return ramp[ramp.length - 2];
  }
  if (t < WORDMARK_LETTER_START_MS) return null;
  if (t < arrival(x, y)) return null;
  return heatAt(heatK(t, x, y), ramp);
}

interface Run {
  fg: string | null;
  bg: string | null;
  text: string;
}

/** Collapse the pixel grid into styled half-block runs, one per display row. */
function renderRuns(t: number, ramp: readonly string[], flash: string): Run[][] {
  const rows: Run[][] = [];
  for (let r = 0; r < WORDMARK_ROWS; r++) {
    const yTop = r * 2;
    const yBottom = r * 2 + 1;
    const cells: Run[] = [];
    for (let x = 0; x < WORDMARK_COLS; x++) {
      const top = pixelColor(t, x, yTop, ramp, flash);
      const bottom = pixelColor(t, x, yBottom, ramp, flash);
      if (!top && !bottom) cells.push({ fg: null, bg: null, text: " " });
      else if (top && !bottom) cells.push({ fg: top, bg: null, text: "▀" });
      else if (!top && bottom) cells.push({ fg: bottom, bg: null, text: "▄" });
      else if (top === bottom) cells.push({ fg: top, bg: null, text: "█" });
      else cells.push({ fg: top, bg: bottom, text: "▀" });
    }
    const runs: Run[] = [];
    let current: Run | null = null;
    for (const cell of cells) {
      if (current && current.fg === cell.fg && current.bg === cell.bg) {
        current.text += cell.text;
      } else {
        if (current) runs.push(current);
        current = { ...cell };
      }
    }
    if (current) runs.push(current);
    rows.push(runs);
  }
  return rows;
}

export type WordmarkMode = "plain" | "static" | "animate";

/**
 * Which empty state to render. Pure and exported so every branch is testable
 * without a TTY: a non-TTY, a too-small terminal, or NO_COLOR forces the plain
 * text fallback; ANVIL_NO_ANIM renders the settled wordmark without animating.
 */
export function wordmarkMode(env: {
  cols: number;
  rows: number;
  isTTY: boolean | undefined;
  noColor: boolean;
  noAnim: boolean;
}): WordmarkMode {
  if (env.noColor || env.isTTY !== true || env.cols < 34 || env.rows < 16) return "plain";
  return env.noAnim ? "static" : "animate";
}

/**
 * The wordmark. Animates from black to fully settled over
 * WORDMARK_ANIM_DURATION_MS, then STOPS: the interval is cleared the moment it
 * settles, and again on unmount, so a boot animation can never become a
 * permanent 20 fps re-render. Any keypress settles it early — the key is not
 * consumed, so the character still reaches the input bar.
 */
export function WordmarkAnimation({
  onSettled,
  skipAnimation = false,
}: {
  onSettled?: () => void;
  skipAnimation?: boolean;
}) {
  const theme = useTheme();
  const [t, setT] = useState(skipAnimation ? WORDMARK_ANIM_DURATION_MS : 0);
  const settledRef = useRef(skipAnimation);
  // Held in a ref, NOT an effect dependency: callers pass an inline arrow, so a
  // dependency here would restart the animation on every single render.
  const onSettledRef = useRef(onSettled);
  onSettledRef.current = onSettled;

  useEffect(() => {
    if (settledRef.current) return;
    let elapsed = 0;
    const id = setInterval(() => {
      elapsed += WORDMARK_ANIM_FRAME_MS;
      if (elapsed >= WORDMARK_ANIM_DURATION_MS) {
        // Hard stop: the animation is a boot flourish, not a spinner.
        clearInterval(id);
        settledRef.current = true;
        setT(WORDMARK_ANIM_DURATION_MS);
        onSettledRef.current?.();
        return;
      }
      setT(elapsed);
    }, WORDMARK_ANIM_FRAME_MS);
    return () => clearInterval(id);
  }, []);

  useInput(() => {
    if (settledRef.current) return;
    settledRef.current = true;
    setT(WORDMARK_ANIM_DURATION_MS);
    onSettledRef.current?.();
  });

  const ramp = [
    theme.colors.textMuted,
    theme.colors.warning,
    theme.colors.accent,
    theme.colors.brand,
    theme.colors.textPrimary,
  ];
  const rows = renderRuns(t, ramp, theme.colors.textPrimary);
  return (
    <Box flexDirection="column" alignItems="center">
      {rows.map((runs, i) => (
        <Text key={i}>
          {runs.map((run, j) => (
            <Text key={j} color={run.fg ?? undefined} backgroundColor={run.bg ?? undefined}>
              {run.text}
            </Text>
          ))}
        </Text>
      ))}
    </Box>
  );
}
