import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { atomicWriteBuffer, atomicWriteText, atomicWriteTextSync } from "../atomicWrite.js";

async function modeOf(file: string): Promise<number> {
  return (await fs.stat(file)).mode & 0o777;
}

/**
 * `open()` masks a creation mode with the process umask, so passing `mode` to
 * `writeFile` was not enough: `0666` landed as `0644` and a `0777` script lost
 * its group/other bits on every edit and every rewind. The callers that pass a
 * mode (`write_file`, `edit_file`, rewind restore) all promise the target's bits
 * survive the rename, and the sync writers already defeat the umask explicitly,
 * so the async writers must match. The mode-preservation test that existed used
 * `0755` only — the one mode where `mode & ~022` is `mode`, which hid this.
 */
describe("atomic writers preserve the requested permission bits", () => {
  it("re-applies the bits a umask trims, matching the sync writer", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "anvil-atomic-mode-"));
    const previousUmask = process.umask(0o022);
    try {
      for (const mode of [0o666, 0o777, 0o755]) {
        const label = mode.toString(8);
        const textTarget = path.join(dir, `text-${label}`);
        const bufferTarget = path.join(dir, `buffer-${label}`);
        const syncTarget = path.join(dir, `sync-${label}`);

        await fs.writeFile(textTarget, "seed", { mode });
        await fs.chmod(textTarget, mode);

        await atomicWriteText(textTarget, "written", { mode });
        await atomicWriteBuffer(bufferTarget, Buffer.from("written"), { mode });
        atomicWriteTextSync(syncTarget, "written", { mode });

        expect(await modeOf(textTarget), `text ${label}`).toBe(mode);
        expect(await modeOf(bufferTarget), `buffer ${label}`).toBe(mode);
        expect(await modeOf(syncTarget), `sync ${label}`).toBe(mode);
        expect(await fs.readFile(textTarget, "utf8")).toBe("written");
      }
    } finally {
      process.umask(previousUmask);
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
