import { MessageContent, Role } from "../providers/types.js";
import {
  SESSION_SEARCH_MAX_RESULTS,
  SESSION_SEARCH_MAX_SNIPPETS,
  SESSION_SEARCH_MIN_QUERY_CHARS,
  SESSION_SEARCH_SNIPPET_CHARS,
} from "../config/constants.js";
import { SessionMetadata } from "./types.js";
import { listSessions, loadSession } from "./store.js";

export { SESSION_SEARCH_MIN_QUERY_CHARS };

/** One excerpt around a match, with the role that carried it. */
export interface SessionSearchSnippet {
  role: Role;
  text: string;
}

export interface SessionSearchMatch {
  metadata: SessionMetadata;
  /** True when the session TITLE matched — snippets can then be empty. */
  matchedTitle: boolean;
  /** How many MESSAGES matched (the title is not a message). */
  matchCount: number;
  /** Up to `SESSION_SEARCH_MAX_SNIPPETS` single-line excerpts. */
  snippets: SessionSearchSnippet[];
}

/** Collapse a message's runs of whitespace so a query can span its line breaks. */
function collapse(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * The searchable text of a message. Only `text` blocks count: a `tool_result`
 * is a verbatim file/command dump, so matching it would return every session
 * that ever read a file for any query naming that file.
 */
function searchableText(content: MessageContent[]): string {
  let joined = "";
  for (const block of content) {
    if (block.type !== "text") continue;
    joined += (joined ? " " : "") + block.text;
  }
  return collapse(joined);
}

/** A single-line window centred on the match, ellipsised at the cut edges. */
function excerpt(text: string, needle: string): string {
  const at = text.toLowerCase().indexOf(needle);
  if (at < 0) return text.slice(0, SESSION_SEARCH_SNIPPET_CHARS);
  // A query longer than the window must still be shown in full, or the snippet
  // would not contain what was searched for.
  const windowLen = Math.max(SESSION_SEARCH_SNIPPET_CHARS, needle.length);
  const lead = Math.max(0, Math.floor((windowLen - needle.length) / 2));
  const start = Math.max(0, at - lead);
  const end = Math.min(text.length, start + windowLen);
  return `${start > 0 ? "…" : ""}${text.slice(start, end)}${end < text.length ? "…" : ""}`;
}

/**
 * Search saved sessions by transcript text (case-insensitive substring), the
 * answer to "which session did I work on X in?" — session TITLES are unreliable
 * and file-level search just duplicates `git log`.
 *
 * Most recently updated first (matching `listSessions`), so a hit list is
 * ordered by how likely you are to still care about it. Corrupt session files
 * are skipped, never thrown over — one bad file must not break the search.
 */
export function searchSessions(query: string, dir?: string): SessionSearchMatch[] {
  const trimmed = query.trim();
  if (trimmed.length < SESSION_SEARCH_MIN_QUERY_CHARS) return [];
  const needle = trimmed.toLowerCase();

  const matches: SessionSearchMatch[] = [];
  for (const metadata of listSessions(dir)) {
    if (matches.length >= SESSION_SEARCH_MAX_RESULTS) break;

    const stored = dir === undefined ? loadSession(metadata.id) : loadSession(metadata.id, dir);
    // null = shape-checked rejection of a partial/corrupt file.
    if (!stored) continue;

    const snippets: SessionSearchSnippet[] = [];
    let matchCount = 0;
    for (const message of stored.history) {
      const text = searchableText(message.content);
      if (text === "" || !text.toLowerCase().includes(needle)) continue;
      matchCount++;
      if (snippets.length < SESSION_SEARCH_MAX_SNIPPETS) {
        snippets.push({ role: message.role, text: excerpt(text, needle) });
      }
    }

    const matchedTitle = metadata.title.toLowerCase().includes(needle);
    if (matchCount === 0 && !matchedTitle) continue;
    matches.push({ metadata, matchedTitle, matchCount, snippets });
  }
  return matches;
}
