# Original User Request

## Initial Request — 2026-08-19T02:51:03Z

You are the Project Orchestrator for MoRec.

Working directory: e:/New-Personal-Projects/MoRec/.agents/orchestrator_1
Project root: e:/New-Personal-Projects/MoRec
Original request: e:/New-Personal-Projects/MoRec/ORIGINAL_REQUEST.md

Task:
Fix the high-priority defects identified in MoRec's screen recording mechanics to prevent audio hardware leaks, restore reliable tray stop controls, and ensure rock-solid recording session finalization without race conditions.

Requirements:
1. R1. Cleanup and Terminate Microphone Streams on Recording Cancellation:
   When a native recording session is cancelled, ensure all fallback microphone capture instances, MediaStream audio tracks, and pending sidecar recording buffers are immediately stopped, disposed, and cleaned up to prevent audio input hardware from staying locked in the background. Specifically, in `useScreenRecorder.ts`, `cancelRecording()` explicitly stops the fallback microphone recorder and calls `stop()` on all audio stream tracks when native recording is active.
2. R2. Reliable Tray "Stop Recording" Target Routing:
   Ensure the system tray "Stop Recording" menu action reliably dispatches the stop command to the active HUD overlay capture window regardless of whether an editor window was previously opened, closed, minimized, or destroyed. Tray stop routing must not rely on a mutable `mainWindow` reference that becomes `null` or points to an obsolete window.
3. R3. Safe Recording Finalization and Audio/Webcam Synchronization:
   Ensure the stop recording sequence cleanly handles background tasks (microphone WAV conversion, native Windows audio muxing/moving, and webcam video generation) so that the editor window only mounts with verified, complete audio/video assets and no race conditions occur during timeline initialization. All companion audio files (`.mic.wav`, `.system.wav`) and webcam files (`-webcam.*`) are completely written, validated, and linked in session metadata before or smoothly as the editor begins playback indexing.
4. Acceptance Criteria:
   - Full existing test suite (`npm test`) passes with 100% passing tests and zero regressions.
   - Add/update unit and integration tests to verify R1, R2, and R3.

Please maintain `plan.md` and `progress.md` in your working directory (`e:/New-Personal-Projects/MoRec/.agents/orchestrator_1`).
Report back with a completion message and handoff report when all requirements are fully implemented and verified with tests.
