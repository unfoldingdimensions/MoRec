# Orchestrator Plan

## Goal
Fix three high-priority recording defects (R1, R2, R3) in MoRec, write comprehensive unit & integration tests, and ensure full test suite passes with zero regressions.

## Phases
1. **Phase 0: Survey & Exploration**
   - Spawn 3 parallel Explorers:
     - Explorer 1: Focus on R1 (Microphone stream cleanup on cancellation in `useScreenRecorder.ts`, native recording teardown, fallback mic disposal, audio track termination).
     - Explorer 2: Focus on R2 (Tray Stop Recording routing in main process / tray menu / HUD overlay window management, avoiding stale `mainWindow` references).
     - Explorer 3: Focus on R3 (Safe recording finalization, background tasks: mic WAV conversion, Windows audio muxing/moving, webcam video generation, session metadata verification before editor mounting).
   - Aggregate findings and create `PROJECT.md`.

2. **Phase 1: Implementation of M1 (R1 - Audio Hardware Leaks & Stream Cleanup on Cancellation)**
   - Worker implements cleanup logic.
   - Reviewers, Challengers, and Forensic Auditor verify.
   - Gate status recorded.

3. **Phase 2: Implementation of M2 (R2 - Reliable Tray Stop Recording Routing)**
   - Worker implements reliable window lookup/IPC routing for tray actions.
   - Reviewers, Challengers, and Forensic Auditor verify.
   - Gate status recorded.

4. **Phase 3: Implementation of M3 (R3 - Safe Recording Finalization & Audio/Webcam Synchronization)**
   - Worker implements synchronized asset finalization, session metadata validation, and race-condition prevention.
   - Reviewers, Challengers, and Forensic Auditor verify.
   - Gate status recorded.

5. **Phase 4: Full Verification & E2E Acceptance**
   - Run full test suite (`npm test`), verify all existing and new tests pass.
   - Reviewers and Auditor verify entire workspace integrity.
   - Final report and handoff to user.
