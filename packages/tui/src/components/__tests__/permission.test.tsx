import { describe, expect, it, vi } from "vitest";
import { PermissionPrompt, mcpServerOf } from "../PermissionPrompt.js";
import type { PendingPermissionRequest } from "../../permission/TuiPermissionBroker.js";
import { frameText, renderThemed, tick } from "../../test-utils/testRender.js";

const UP = "\u001B[A";
const DOWN = "\u001B[B";
const ENTER = "\r";

function makeRequest(toolName: string, summary: string): {
  request: PendingPermissionRequest;
  decided: Promise<boolean>;
} {
  let resolve!: (approved: boolean) => void;
  const decided = new Promise<boolean>((res) => {
    resolve = res;
  });
  return { request: { toolName, summary, resolve }, decided };
}

function brokerStub() {
  return { approveAlwaysForSession: vi.fn() };
}

const DIFF = [
  "--- a/app.ts",
  "+++ b/app.ts",
  "@@ -1 +1 @@",
  "-old",
  "+new",
].join("\n");

describe("PermissionPrompt", () => {
  it("shows active phrasing plus the diff for file tools", async () => {
    const { request } = makeRequest("edit_file", DIFF);
    const app = renderThemed(<PermissionPrompt request={request} broker={brokerStub()} />);
    await tick();
    const out = frameText(app.lastFrame);
    expect(out).toContain("wants to edit a file");
    expect(out).toContain("old");
    expect(out).toContain("new");
    expect(out).toContain("Allow once");
    app.unmount();
  });

  it("shows command text (not a diff) for run_command", async () => {
    const { request } = makeRequest("run_command", "Run command: npm test");
    const app = renderThemed(<PermissionPrompt request={request} broker={brokerStub()} />);
    await tick();
    const out = frameText(app.lastFrame);
    expect(out).toContain("wants to run a command");
    expect(out).toContain("Run command: npm test");
    app.unmount();
  });

  it("Enter on the first row allows once without always-approve", async () => {
    const { request, decided } = makeRequest("edit_file", DIFF);
    const broker = brokerStub();
    const app = renderThemed(<PermissionPrompt request={request} broker={broker} />);
    await tick();
    app.stdin.write(ENTER);
    await expect(decided).resolves.toBe(true);
    expect(broker.approveAlwaysForSession).not.toHaveBeenCalled();
    app.unmount();
  });

  it("resets the highlight when a new queued request arrives", async () => {
    const first = makeRequest("edit_file", DIFF);
    const broker = brokerStub();
    const app = renderThemed(<PermissionPrompt request={first.request} broker={broker} />);
    await tick();
    // Move highlight down to "Always allow", then swap in the next request.
    app.stdin.write(DOWN);
    await tick();
    const second = makeRequest("run_command", "Run command: rm -rf ./build");
    app.rerender(<PermissionPrompt request={second.request} broker={broker} />);
    await tick();
    // Fast Enter must hit "Allow once" (row 0), not the stale "Always allow".
    app.stdin.write(ENTER);
    await expect(second.decided).resolves.toBe(true);
    expect(broker.approveAlwaysForSession).not.toHaveBeenCalled();
    app.unmount();
  });

  it("parses mcp_<server>__<tool> names (servers may contain underscores)", () => {
    expect(mcpServerOf("mcp_my-tools__read_doc")).toEqual({ server: "my-tools", tool: "read_doc" });
    expect(mcpServerOf("mcp_srv__t")).toEqual({ server: "srv", tool: "t" });
    expect(mcpServerOf("edit_file")).toBeNull();
    expect(mcpServerOf("mcp_noseparator")).toBeNull();
    expect(mcpServerOf("mcp___tool")).toBeNull();
  });

  it("names the real server when the server id itself contains the separator", () => {
    // The prompt is a consent surface: naming `my` while the call goes to
    // `my__server` is worse than saying nothing. Configured ids resolve it.
    const ids = ["my", "my__server"];
    expect(mcpServerOf("mcp_my__server__read_doc", ids)).toEqual({
      server: "my__server",
      tool: "read_doc",
    });
    // Tool names keep `__`; the id list disambiguates without truncating it.
    expect(mcpServerOf("mcp_srv__read__doc", ["srv"])).toEqual({ server: "srv", tool: "read__doc" });
  });

  it("names the MCP server with badge, parameter list, and warns about external visibility", async () => {
    const { request } = makeRequest("mcp_docs__fetch", "Parameters:\n  • query: \"anvil\"\n  • limit: 5");
    const app = renderThemed(<PermissionPrompt request={request} broker={brokerStub()} />);
    await tick();
    const out = frameText(app.lastFrame);
    expect(out).toContain("[mcp:docs] fetch");
    expect(out).toContain("wants to run external tool fetch");
    expect(out).toContain("visible to that server");
    expect(out).toContain("Parameters:");
    expect(out).toContain("• query: \"anvil\"");
    expect(out).toContain("• limit: 5");
    app.unmount();
  });

  it("second row always-allows this session, third row denies", async () => {
    const first = makeRequest("write_file", DIFF);
    const broker = brokerStub();
    const app1 = renderThemed(<PermissionPrompt request={first.request} broker={broker} />);
    await tick();
    app1.stdin.write(DOWN);
    await tick();
    app1.stdin.write(ENTER);
    await expect(first.decided).resolves.toBe(true);
    expect(broker.approveAlwaysForSession).toHaveBeenCalledWith("write_file");
    app1.unmount();

    const second = makeRequest("write_file", DIFF);
    const app2 = renderThemed(<PermissionPrompt request={second.request} broker={brokerStub()} />);
    await tick();
    app2.stdin.write(DOWN);
    await tick();
    app2.stdin.write(DOWN);
    await tick();
    app2.stdin.write(UP); // back up one: proves arrows move both directions
    await tick();
    app2.stdin.write(DOWN);
    await tick();
    app2.stdin.write(ENTER);
    await expect(second.decided).resolves.toBe(false);
    app2.unmount();
  });
});
