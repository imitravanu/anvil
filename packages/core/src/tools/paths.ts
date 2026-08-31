import path from "node:path";

export class PathEscapeError extends Error {
  constructor(attempted: string) {
    super(`Path escapes project root: ${attempted}`);
    this.name = "PathEscapeError";
  }
}

// Resolves `requested` against `root`, and throws if the result is not inside `root`.
// Every tool below must call this instead of `path.resolve` directly.
// Note: this is lexical containment (path.relative based) — it blocks `..` traversal
// and absolute escapes; it does not follow symlinks. Tools that create files (not
// resolve existing symlinks) are safe with lexical checks; a symlink-aware check
// (fs.realpath on the deepest existing ancestor) can be layered in later if needed.
export function resolveWithinRoot(root: string, requested: string): string {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, requested);
  const relative = path.relative(resolvedRoot, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new PathEscapeError(requested);
  }
  return resolved;
}
