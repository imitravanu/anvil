import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeEach } from "vitest";

const originalHome = process.env.ANVIL_HOME;
const testHome = fs.mkdtempSync(path.join(os.tmpdir(), "anvil-test-home-"));
process.env.ANVIL_HOME = testHome;
beforeEach(() => { process.env.ANVIL_HOME = testHome; });
afterEach(() => { process.env.ANVIL_HOME = testHome; });
afterAll(() => {
  if (originalHome === undefined) delete process.env.ANVIL_HOME;
  else process.env.ANVIL_HOME = originalHome;
  fs.rmSync(testHome, { recursive: true, force: true });
});
