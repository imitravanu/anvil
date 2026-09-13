import { describe, expect, it } from "vitest";
import { execute as executeUpdatePlan, executeSession as executeSessionUpdatePlan } from "../updatePlan.js";
import { execute as executeDelegateTask } from "../delegateTask.js";

describe("Tool Real Execution (Phase 24.16)", () => {
  it("update_plan rejects invalid plan and validates input", async () => {
    const invalid = await executeUpdatePlan({ plan: "" });
    expect(invalid.isError).toBe(true);
    expect((invalid.output as { error: string }).error).toContain("requires a string `plan`");

    const valid = await executeUpdatePlan({ plan: "Step 1: Write code" });
    expect(valid.isError).toBe(false);
    expect(valid.output).toEqual({ ok: true, plan: "Step 1: Write code" });
  });

  it("delegate_task validates task input and rejects empty task", async () => {
    const invalid = await executeDelegateTask({ task: "" });
    expect(invalid.isError).toBe(true);
    expect((invalid.output as { error: string }).error).toContain("requires a string `task`");

    const valid = await executeDelegateTask({ task: "Investigate tests" });
    expect(valid.isError).toBe(true);
    expect((valid.output as { error: string }).error).toContain("requires an active AgentSession execution context");
  });
});
