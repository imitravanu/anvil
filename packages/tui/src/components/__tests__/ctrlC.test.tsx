import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentSession, createProviders } from "@anvil/core";
import { App } from "../App.js";
import { FirstRunSetup } from "../FirstRunSetup.js";
import { TuiPermissionBroker } from "../../permission/TuiPermissionBroker.js";
import { frameText, renderThemed, tick } from "../../test-utils/testRender.js";
import { PROVIDER_META } from "../../util/providers.js";

const { exit } = vi.hoisted(() => ({ exit: vi.fn() }));
vi.mock("ink", async importOriginal => ({
  ...await importOriginal<typeof import("ink")>(),
  useApp: () => ({ exit }),
}));
afterEach(() => exit.mockClear());

describe("app-level Ctrl+C ownership", () => {
  it.each([false, true])("exits standalone setup (custom wizard: %s)", async custom => {
    const app = renderThemed(<FirstRunSetup onDone={vi.fn()} />);
    await tick();
    if (custom) {
      // Last provider row opens the custom flow without touching credentials.
      for (const _provider of PROVIDER_META) {
        app.stdin.write("\u001B[B");
        await tick();
      }
      app.stdin.write("\r");
      await tick();
      expect(frameText(app.lastFrame)).toContain("Display name");
    }
    app.stdin.write("\x03");
    await tick();
    expect(exit).toHaveBeenCalledOnce();
    app.unmount();
  });

  it("exits once when idle with the help overlay open", async () => {
    const providers = createProviders({});
    const broker = new TuiPermissionBroker();
    const sessionOptions = { projectRoot: process.cwd(), systemPrompt: "test", maxTokens: 1000 };
    const session = new AgentSession(providers.anthropic, { ...sessionOptions, model: "test", permissionBroker: broker });
    const app = renderThemed(<App session={session} broker={broker} providers={providers} providerId="anthropic" model="test" sessionOptions={sessionOptions} />);
    await tick();
    app.stdin.write("?");
    await tick();
    app.stdin.write("\x03");
    await tick();
    expect(exit).toHaveBeenCalledOnce();
    app.unmount();
  });
});
