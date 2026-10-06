import { COMMANDS } from "./registry.js";

/**
 * Phase 41 — help content as data, derived from the live registry.
 *
 * The old `/help` printed a prose block into the transcript: it could not be
 * searched, it scrolled the user's own turn out of the window, and every new
 * command had to remember to add itself to an EXAMPLES map. The rows here come
 * from `COMMANDS` itself, so a new command is discoverable the moment it is
 * registered, and the key rows are the keybindings the handlers actually
 * implement (InputBar/App/XxxModal `useInput`).
 */

export interface HelpRow {
  /** Left column: a key chord or `/command`. */
  primary: string;
  /** Right column: what it does. */
  secondary: string;
}

export type HelpSectionId = "keys" | "overlays" | "commands";

export interface HelpSection {
  id: HelpSectionId;
  title: string;
  rows: HelpRow[];
}

/**
 * Verified against the handlers — not aspirational documentation:
 * InputBar (Enter/`/`/Tab/↑↓/Esc/Ctrl+C), App (Tab focus zones, PgUp/PgDn/↑↓
 * transcript scroll when focused), ModelPicker&co. (↑↓/Enter/Esc),
 * `?` (InputBar empty-prompt help).
 */
export const HELP_KEYS: readonly HelpRow[] = [
  { primary: "Enter", secondary: "Send the message (queues while a turn runs)" },
  { primary: "/", secondary: "Open the command palette" },
  { primary: "Tab", secondary: "Complete the highlighted command, else move focus input↔transcript" },
  { primary: "↑ / ↓", secondary: "Recall sent messages (input focused); scroll transcript (transcript focused); navigate menus" },
  { primary: "Esc", secondary: "Cancel the running turn, or dismiss a menu or overlay" },
  { primary: "Ctrl+C", secondary: "Cancel while busy; exit when idle" },
  { primary: "PgUp / PgDn", secondary: "Scroll the transcript (5 messages per press)" },
  { primary: "?", secondary: "Open this help" },
];

/**
 * Keys that only exist INSIDE an overlay — the contract each modal prints in
 * its own header, collected so one screen documents every shortcut.
 */
export const HELP_OVERLAY_KEYS: readonly HelpRow[] = [
  { primary: "↑ / ↓", secondary: "Move the highlight in pickers and the rewind list" },
  { primary: "Enter", secondary: "Confirm the highlighted row" },
  { primary: "type", secondary: "Model picker & help: type to filter, Backspace erases" },
  { primary: "Tab ← →", secondary: "Diff inspector: switch the changed file" },
  { primary: "S", secondary: "Diff inspector: toggle side-by-side" },
  { primary: "C", secondary: "Diff inspector: copy the visible diff (OSC 52)" },
  { primary: "y a n", secondary: "Permission prompt: allow once / always this session / deny" },
  { primary: "Esc", secondary: "Close the overlay (theme picker restores the previous theme)" },
];

/** Sections in display order: keys first (what a new user pressing `?`
 * needs), then the command list (still inside the first window), and the
 * overlay-only shortcuts last — nothing a routine lookup has to scroll past. */
export function helpSections(): HelpSection[] {
  return [
    { id: "keys", title: "Keys", rows: [...HELP_KEYS] },
    {
      id: "commands",
      title: "Commands",
      rows: COMMANDS.map((command) => ({
        primary: `/${command.name}`,
        secondary: command.description,
      })),
    },
    { id: "overlays", title: "Inside overlays", rows: [...HELP_OVERLAY_KEYS] },
  ];
}

/**
 * Case-insensitive substring filter over both columns. Sections whose rows all
 * drop are removed entirely (never rendered as empty headers), and an empty
 * query returns everything.
 */
export function filterHelpSections(sections: readonly HelpSection[], query: string): HelpSection[] {
  const q = query.trim().toLowerCase();
  if (!q) return sections.map((section) => ({ ...section, rows: [...section.rows] }));
  return sections
    .map((section) => ({
      ...section,
      rows: section.rows.filter((row) => `${row.primary} ${row.secondary}`.toLowerCase().includes(q)),
    }))
    .filter((section) => section.rows.length > 0);
}
