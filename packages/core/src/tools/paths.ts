import fs from "node:fs";
import path from "node:path";

export class PathEscapeError extends Error {
  constructor(attempted: string) {
    super(`Path escapes project root: ${attempted}`);
    this.name = "PathEscapeError";
  }
}

// Resolves `requested` against `root`, and throws if the result is not inside `root`.
// Every tool below must call this instead of `path.resolve` directly. The deepest
// existing ancestor is resolved through symlinks, blocking a link inside the
// project that points outside it. (As with any filesystem check, a hostile
// concurrent rename between check and use remains outside this helper's scope.)
export function resolveWithinRoot(root: string, requested: string): string {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, requested);
  const relative = path.relative(resolvedRoot, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new PathEscapeError(requested);
  }
  // A non-existent root has no symlinks to resolve. This also keeps the helper
  // usable by callers validating a prospective project directory.
  if (!fs.existsSync(resolvedRoot)) return resolved;
  let existing = resolved;
  while (!fs.existsSync(existing)) {
    const parent = path.dirname(existing);
    if (parent === existing) break;
    existing = parent;
  }
  const physicalRoot = fs.realpathSync(resolvedRoot);
  const physicalExisting = fs.existsSync(existing) ? fs.realpathSync(existing) : existing;
  const physicalRelative = path.relative(physicalRoot, physicalExisting);
  if (physicalRelative.startsWith("..") || path.isAbsolute(physicalRelative)) {
    throw new PathEscapeError(requested);
  }
  return resolved;
}
