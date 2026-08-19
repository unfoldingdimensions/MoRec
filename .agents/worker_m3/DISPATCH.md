## 2026-08-19T03:16:02Z

You are Worker 3 for Milestone 3 (R3 - Safe Recording Finalization and Audio/Webcam Synchronization).
Your working directory is e:/New-Personal-Projects/MoRec/.agents/worker_m3.

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

First, read:
1. e:/New-Personal-Projects/MoRec/ORIGINAL_REQUEST.md
2. e:/New-Personal-Projects/MoRec/PROJECT.md
3. e:/New-Personal-Projects/MoRec/.agents/explorer_survey_3/analysis.md
4. e:/New-Personal-Projects/MoRec/.agents/explorer_survey_3/handoff.md

Scope of changes (Exclusive write ownership):
- src/hooks/useScreenRecorder.ts:
  1. In stopRecording (both native recording and browser MediaRecorder paths):
     - Eliminate unawaited background async IIFEs (oid (async () => { ... })()).
     - Concurrently initiate companion stopping (stopMicFallbackRecorder(), stopWebcamRecorder()).
     - Await the primary recording file path.
     - Await the webcam file path (const webcamPath = await webcamPathPromise or esolvedWebcamPath.current).
     - Await microphone sidecar processing (wait storeMicrophoneSidecar(...)).
     - Await Windows companion audio handling (if (isNativeWindows) await window.electronAPI.muxNativeWindowsRecording(...)).
     - Call wait finalizeRecordingSession(finalPath, webcamPath) with the actual resolved webcamPath (ensuring session metadata .morec-session.json is atomically written before switching to editor).
     - Call window.electronAPI.hudOverlayClose() only after session finalization and editor transition have completed.
- src/hooks/useScreenRecorder.test.ts:
  Add and update unit/integration tests to verify that:
  - Companion asset promises (webcamPathPromise, micFallbackBlobPromise, muxNativeWindowsRecording) are fully awaited during stop finalization.
  - inalizeRecordingSession receives the verified webcamPath (not null).
  - HUD overlay close occurs strictly after session finalization.
  - No race conditions occur when starting/stopping recordings with webcam and fallback mic.

Verification:
- Run the test suite: 
px vitest run src/hooks/useScreenRecorder.test.ts and ensure full 
pm test passes without regressions.
- Ensure 
px tsc --noEmit has 0 errors.
- Document all changes and test outputs in e:/New-Personal-Projects/MoRec/.agents/worker_m3/handoff.md.
- Send a message when done.
