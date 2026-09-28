import fs from "node:fs";
import path from "node:path";

export class PathEscapeError extends Error {
  constructor(attempted: string) {
    super(`Path escapes project root: ${attempted}`);
    this.name = "PathEscapeError";
  }
}

/**
 * Directory names every filesystem-walking tool skips (single source — was
 * duplicated across grep/listFiles/outline/awareness with drifting members).
 * The union is canonical: skipping `build`/`.next` everywhere is the intent
 * (generated output, no source value, multi-MB scans).
 */
/**
 * Directories that are build output, dependency trees, or bytecode caches —
 * never the user's source. Every walk shares this one set: the symbol index
 * (build + freshness discovery), grep, list_files, get_outline, goal awareness.
 *
 * Phase 37 added the Rust/Go/Python entries from a measured probe: a
 * non-excluded Rust build tree put 200 generated files / 400 symbols into a
 * fixture index (`gen_fn_7` resolvable by find_symbol), and a real project on
 * this machine holds 17,997 files / 15 GB under `target/` — currently skipped
 * only by luck, because its generated `.rs` files happen to live under an
 * already-excluded `build/` name. A generated symbol that outranks the user's
 * code is exactly the confidently-wrong answer the index exists to prevent.
 */
export const EXCLUDED_DIRS: ReadonlySet<string> = new Set([
  "node_modules", ".git", "dist", ".anvil", "build", ".next",
  "target", "vendor", "__pycache__", ".venv", "venv",
]);

// Resolves `requested` against `root`, and throws if the result is not inside `root`.
// Every tool below must call this instead of `path.resolve` directly. The deepest
// existing ancestor is resolved through symlinks, blocking a link inside the
// project that points outside it. (As with any filesystem check, a hostile
// concurrent rename between check and use remains outside this helper's scope.)
export function resolveWithinRoot(root: string, requested: string): string {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, requested);
  if (!isInsideRoot(resolvedRoot, resolved)) {
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
  if (!isInsideRoot(physicalRoot, physicalExisting)) {
    throw new PathEscapeError(requested);
  }
  return resolved;
}

/** Relative-path containment: `..` itself or any `../` prefix escapes.
 *  A name that merely STARTS with dots (`..config`) is a legitimate file. */
function isInsideRoot(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return !(relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative));
}
