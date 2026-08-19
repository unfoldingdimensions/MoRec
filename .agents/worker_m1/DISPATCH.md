# Dispatch - 2026-08-19T02:56:46Z

You are Worker 1 for Milestone 1 (R1 - Audio Hardware Leaks & Stream Cleanup on Cancellation).
Your working directory is e:/New-Personal-Projects/MoRec/.agents/worker_m1.

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

First, read:
1. e:/New-Personal-Projects/MoRec/ORIGINAL_REQUEST.md
2. e:/New-Personal-Projects/MoRec/PROJECT.md
3. e:/New-Personal-Projects/MoRec/.agents/explorer_survey_1/analysis.md
4. e:/New-Personal-Projects/MoRec/.agents/explorer_survey_1/handoff.md

Scope of changes (Exclusive write ownership):
- `src/hooks/useScreenRecorder.ts`:
  1. In `cancelRecording()`, call `cleanupCapturedMedia()` unconditionally before dispatching native recording cancellation, ensuring fallback microphone recorders, media stream tracks, and buffers are completely stopped and disposed.
  2. Ensure `cleanupCapturedMedia()` thoroughly cleans up `micFallbackRecorder` (detaches listeners, stops all tracks on `micFallbackRecorder.current.stream`, clears `micFallbackChunks.current`, clears diagnostic buffers), and stops any tracks on `microphoneStream.current`, `stream.current`, `screenStream.current`, and closes `mixingContext.current`.
- `electron/ipc/register/project.ts`:
  Enhance `delete-recording-file` IPC handler so that when deleting a recording file upon cancellation or discard, it defensively removes associated companion sidecars (`.mic.wav`, `.system.wav`, `.mic.wav.json`, `.system.wav.json`, `.diagnostics.json`, `-webcam.*`).
- `src/hooks/useScreenRecorder.test.ts`:
  Add and update unit/integration tests to verify that cancelling a recording (both native mode with fallback mic and browser mode) explicitly invokes track `.stop()` on fallback microphone streams and cleans up all state.

Verification:
- Run the test suite: `npx vitest run src/hooks/useScreenRecorder.test.ts` and ensure full `npm test` passes without regressions.
- Document all changes and test outputs in `e:/New-Personal-Projects/MoRec/.agents/worker_m1/handoff.md`.
- Send a message when done.
