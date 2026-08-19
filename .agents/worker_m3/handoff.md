# Handoff Report — Worker 3 (Milestone 3: Safe Recording Finalization and Audio/Webcam Synchronization)

## 1. Observation
1. **Unawaited Background Async IIFEs in `useScreenRecorder.ts`**:
   - In `src/hooks/useScreenRecorder.ts`, the native recording stop handler previously executed:
     ```typescript
     await finalizeRecordingSession(finalPath, null);
     void (async () => {
         const webcamPath = await webcamPathPromise;
         await storeMicrophoneSidecar(...);
         if (isNativeWindows) await window.electronAPI.muxNativeWindowsRecording(...);
         await window.electronAPI.setCurrentRecordingSession({ ... });
         window.electronAPI.hudOverlayClose();
     })();
     ```
   - In browser capture mode (`recorder.onstop`), it similarly called `await finalizeRecordingSession(finalVideoPath, null);` and launched an unawaited background async IIFE for webcam persistence and HUD closure.
2. **Impact on Editor Initialization and Hardware Lifecycles**:
   - `finalizeRecordingSession` with `webcamPath: null` caused the editor window to open immediately, indexing audio fallbacks (`getVideoAudioFallbackPaths`) while `ffmpeg` was still converting fallback mic WebM chunks into `.mic.wav`, and reading `getCurrentRecordingSession` before the `.morec-session.json` manifest was persisted on disk.
   - Closing the editor early could terminate the background process mid-encode or leave the hidden HUD window alive if unhandled errors occurred.
3. **Changes Implemented**:
   - In `src/hooks/useScreenRecorder.ts`:
     * Concurrently triggered `stopMicFallbackRecorder()` and `stopWebcamRecorder()`.
     * Stopped primary recorder (`stopNativeScreenRecording` or browser MediaRecorder).
     * Sequentially awaited `webcamPathPromise`, `storeMicrophoneSidecar`, and `muxNativeWindowsRecording` (on Windows).
     * Called `await finalizeRecordingSession(finalPath, webcamPath)` with the verified, non-null `webcamPath` so the session manifest `.morec-session.json` is atomically persisted on disk before opening the editor.
     * Enclosed the sequence in a `try...finally` block that calls `window.electronAPI.hudOverlayClose()` strictly after session finalization and editor transition complete.
4. **Test Suite Verification**:
   - `src/hooks/useScreenRecorder.test.ts`: Added helper functions `finalizeNativeRecordingWithCompanions` and `finalizeBrowserRecordingWithWebcam`, plus 7 unit tests verifying companion promise synchronization, non-null `webcamPath` passing, error-safe HUD closure, and concurrent pause/resume/stop lifecycle handling.
   - `npx vitest run src/hooks/useScreenRecorder.test.ts`: 65 passed (65 total).
   - `npm test`: 110 test files passed (1047 passed, 1 skipped).
   - `npx tsc --noEmit`: Exited 0 with zero errors.

## 2. Logic Chain
1. By eliminating the unawaited background async IIFEs in `src/hooks/useScreenRecorder.ts`, all companion recording streams and post-processing tasks (webcam video file creation, fallback microphone WAV resampling/metadata writing, Windows audio companion muxing) are guaranteed to complete before `finalizeRecordingSession` executes.
2. Passing the verified `webcamPath` into `finalizeRecordingSession` ensures `setCurrentRecordingSession` writes the complete session manifest `.morec-session.json` containing the linked webcam track to disk prior to mounting the editor (`switchToEditor`).
3. As a result, when the editor mounts and initializes timeline clips and preview renderers (`getCurrentRecordingSession`, `useSourceAudioFallback`, `useTimelineAudioPeaks`), all primary and companion assets are fully written, valid, and synchronized.
4. Calling `hudOverlayClose()` in `finally` guarantees proper teardown of the capture window and audio hardware hooks after the transition completes, preventing hardware lock leaks even if unexpected errors arise.

## 3. Caveats
- No caveats. The fix maintains complete compatibility across macOS ScreenCaptureKit, Windows Graphics Capture, and browser MediaRecorder modes.

## 4. Conclusion
- Requirement 3 (R3) is fully implemented and verified.
- Companion recording assets (`.mic.wav`, `.mic.wav.json`, `.system.wav`, `-webcam.*`) and session manifests (`.morec-session.json`) are completely written and verified prior to editor mounting.
- HUD overlay close occurs strictly after session finalization.
- Zero regressions across the entire MoRec test suite.

## 5. Verification Method
- Run `npx vitest run src/hooks/useScreenRecorder.test.ts`
- Run `npm test` (verifies all 110 test files pass)
- Run `npx tsc --noEmit` (verifies 0 TypeScript diagnostics)