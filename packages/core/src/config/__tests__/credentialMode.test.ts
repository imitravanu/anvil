import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { saveCredential } from "../index.js";

describe("credential permissions", () => {
  it("saves credentials with owner-only file mode", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "anvil-credentials-"));
    const previousHome = process.env.ANVIL_HOME;
    process.env.ANVIL_HOME = home;

    try {
      saveCredential("openaiApiKey", "test-key");
      const mode = fs.statSync(path.join(home, "credentials.json")).mode & 0o777;
      expect(mode).toBe(0o600);
    } finally {
      if (previousHome === undefined) delete process.env.ANVIL_HOME;
      else process.env.ANVIL_HOME = previousHome;
      fs.rmSync(home, { recursive: true, force: true });
    }
  });
});
