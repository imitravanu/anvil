# PHASE 13 SPEC — Closed-Loop TDD Auto-Verification & Self-Repair Engine

> **Status:** APPROVED & IN IMPLEMENTATION (Directive: "ok", 2026-09-06)  
> **Author:** Chief Engineer  
> **Target:** Anvil v0.6.0  

---

## 0. Objective

Transform Anvil from an open-loop code generator into a **closed-loop test-driven development (TDD) engine**:
1. When file mutations (`write_file`, `edit_file`) occur during a turn, Anvil automatically executes the project's test suite to verify code correctness before declaring the turn complete.
2. If tests fail, Anvil does not dump the broken state onto the user. It captures the test failure trace, feeds it back into the agent context, and allows up to 2 autonomous self-repair attempts within the same turn.
3. Every verification attempt is logged honestly into the sequence-numbered Run Ledger (`RunLedgerEntry`), maintaining full transparency.
4. Exposes a native `verify_tests` tool for on-demand targeted verification.

---

## 1. Design & Architecture

### 1.1 Test Detection Engine (`packages/core/src/tools/verifyTests.ts`)

- **Automatic Command Discovery:**
  1. `.anvil/rules` or `settings.json` `"testCommand"` override.
  2. Node/JS/TS: Inspects `package.json` for `scripts.test`. If default placeholder (`"echo \"Error: no test specified\""`), moves to next.
  3. Python: Checks for `pytest` or `unittest` configuration (`pytest.ini`, `pyproject.toml`, `setup.cfg`).
  4. Rust: Checks for `Cargo.toml` (`cargo test`).
  5. Go: Checks for `go.mod` (`go test ./...`).
- **Execution & Output Parsing:**
  - Invokes the test command using process group isolation with a strict 60s timeout (`RUN_TEST_TIMEOUT_MS = 60_000`).
  - Output is capped to 30KB.
  - Extracts failure traces, failed test count, and failure summary.
- **Tool Export:**
  - Name: `verify_tests`
  - Description: "Run the project test suite or a targeted test pattern to verify regressions. Non-mutating."
  - Input Schema: `{ pattern?: string }` (e.g. specific test file or filter)
  - `mutating: false` (read-only, auto-allowed).

### 1.2 Session Loop Integration (`packages/core/src/agent/session.ts`)

- **Trigger Conditions:**
  - `autoVerify` is enabled (`AgentOptions.autoVerify !== false`).
  - At least one mutating tool (`write_file`, `edit_file`) succeeded during the turn (`turn.hasMutations`).
  - Model has emitted `turn_end` (stopReason != "tool_use").
- **Closed-Loop Repair Cycle (Max 2 Attempts per Turn):**
  1. Emit `verification_started { command }`.
  2. Run verification probe.
  3. If tests pass:
     - Emit `verification_result { passed: true, summary }`.
     - Record in ledger: `{ eventType: "verification_finished", outcome: "ok" }`.
     - Finish turn cleanly (`turn_complete`).
  4. If tests fail and `turn.verifyRepairsUsed < MAX_VERIFY_REPAIRS (2)`:
     - `turn.verifyRepairsUsed += 1`.
     - Emit `verification_result { passed: false, summary }`.
     - Record in ledger: `{ eventType: "verification_finished", outcome: "error" }`.
     - Push synthetic user message into history:
       ```
       [Test Verification Failed]
       Running `${command}` produced failures:
       ${failureTrace}

       Analyze the failure trace, use edit_file to correct the implementation, and ensure tests pass.
       ```
     - Continue turn loop immediately to let the model generate the fix!
  5. If tests still fail after 2 repair attempts:
     - Conclude turn with an honest failure summary:
       `"Code edits applied, but automated test verification could not pass after 2 repair attempts."`
     - Never loop indefinitely.

---

## 2. Acceptance Criteria

- **V1:** `detectTestCommand()` discovers package.json test scripts, Python, Go, Rust, or custom `.anvil/rules`.
- **V2:** `verify_tests` tool executes tests safely and reports structured results (`passed`, `summary`, `failureTrace`).
- **V3:** Passing verification lets turn complete cleanly with `verification_result { passed: true }`.
- **V4:** Failing verification prompts autonomous repair attempt with failure trace in context.
- **V5:** Repair attempts are strictly capped at 2 per turn; budget and cancellation are respected.
- **V6:** Run ledger accurately records all verification outcomes.
- **V7:** 100% green test suite across all packages.
