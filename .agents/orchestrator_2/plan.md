# Plan — Orchestrator Gen 2 (MoRec)

## Objective
Verify Milestone 3 (R3: Safe Recording Finalization and Audio/Webcam Synchronization), verify full test suite & zero regressions for Milestone 4, and deliver comprehensive final handoff to parent.

## Execution Steps

### 1. Milestone 3 Verification (R3)
- Spawn 5 subagents in parallel:
  1. `reviewer_m3_1` (`teamwork_preview_reviewer`): Review `useScreenRecorder.ts` and `useScreenRecorder.test.ts` implementation for correctness, async/await synchronization, and run tests.
  2. `reviewer_m3_2` (`teamwork_preview_reviewer`): Review error handling, `try...finally` HUD closure, edge cases, and run tests.
  3. `challenger_m3_1` (`teamwork_preview_challenger`): Adversarially challenge companion asset synchronization (webcam, mic sidecar, native windows muxing).
  4. `challenger_m3_2` (`teamwork_preview_challenger`): Adversarially challenge session manifest atomicity, concurrent operations, and test runner.
  5. `auditor_m3` (`teamwork_preview_auditor`): Perform forensic integrity audit on M3 modifications in `src/hooks/useScreenRecorder.ts` and `src/hooks/useScreenRecorder.test.ts`.

### 2. Gate Evaluation & State Updates
- Collect all 5 handoff reports.
- Verify:
  - Reviewer 1: APPROVE
  - Reviewer 2: APPROVE
  - Challenger 1: APPROVE
  - Challenger 2: APPROVE
  - Auditor: CLEAN
- Record Gate Result: **PASS** in `GATE_STATUS.md`.
- Update `PROJECT.md` marking M3 **DONE**.

### 3. Milestone 4 Acceptance & Final Verification
- Verify full test suite (110+ suites, 1000+ tests pass, 0 regressions).
- Verify all R1, R2, R3 requirements and acceptance criteria are satisfied.

### 4. Final Reporting & Handoff
- Deliver final completion report to user and send handoff message to parent `da5062bc-f836-49ba-bf4e-c2d28d1ac100`.
