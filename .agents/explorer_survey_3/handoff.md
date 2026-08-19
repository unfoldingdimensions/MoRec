# Handoff Report — Survey Explorer 3 (Requirement 3: Safe Recording Finalization and Audio/Webcam Synchronization)

## 1. Observation
1. **Unawaited Background Post-Processing in `useScreenRecorder.ts`**:
   - In `src/hooks/useScreenRecorder.ts` lines 1129–1186:
     ```typescript
     const finalPath = result.path;

     // 1. Finalize the session and switch to editor immediately (Optimistic UI)
     // We pass null for webcamPath initially to avoid blocking on webcam disk writes/muxing.
     await finalizeRecordingSession(finalPath, null);

     // 2. Perform background finalization (webcam, muxing, sidecars)
     // We don't await this to keep the UI responsive
     void (async () => {
         try {
             const webcamPath = await webcamPathPromise;
             await storeMicrophoneSidecar(
                 micFallbackBlobPromise,
                 finalPath,
                 fallbackStartDelayMs,
                 fallbackTrackSettings,
             );
             if (isNativeWindows) {
                 await window.electronAPI.muxNativeWindowsRecording(expectedDurationMs);
             }
             await window.electronAPI.setCurrentRecordingSession({
                 videoPath: finalPath,
                 webcamPath,
                 timeOffsetMs: webcamTimeOffsetMs.current,
                 hideOverlayCursorByDefault: hideEditorOverlayCursorByDefault.current,
             });
         } catch (bgError) {
             console.error("Error in background finalization:", bgError);
         } finally {
             if (typeof window.electronAPI?.hudOverlayClose === "function") {
                 window.electronAPI.hudOverlayClose();
             }
         }
     })();
     ```
   - In `src/hooks/useScreenRecorder.ts` lines 1858–1885 (Browser recording mode):
     ```typescript
     // 1. Launch editor immediately (Optimistic UI)
     await finalizeRecordingSession(finalVideoPath, null);

     // 2. Background webcam processing
     void (async () => {
         const webcamPath = pendingWebcamPathPromise.current
             ? await pendingWebcamPathPromise.current
             : resolvedWebcamPath.current;

         try {
             if (webcamPath) {
                 await window.electronAPI.setCurrentRecordingSession({
                     videoPath: finalVideoPath,
                     webcamPath,
                     timeOffsetMs: webcamTimeOffsetMs.current,
                     hideOverlayCursorByDefault:
                         hideEditorOverlayCursorByDefault.current,
                 });
             }
         } finally {
             if (typeof window.electronAPI?.hudOverlayClose === "function") {
                 window.electronAPI.hudOverlayClose();
             }
         }
     })();
     ```

2. **`finalizeRecordingSession` Implementation**:
   - In `src/hooks/useScreenRecorder.ts` lines 678–715:
     * When `webcamPath` is `null` (as passed by lines 1131 and 1858), it calls `window.electronAPI.setCurrentVideoPath(videoPath, ...)`.
     * It sets `setFinalizing(false)` and calls `window.electronAPI.switchToEditor()`.

3. **Editor Mounting and Session Asset Consumption**:
   - In `src/components/video-editor/VideoEditor.tsx` lines 2506–2526:
     * `loadInitialData()` executes immediately upon editor mount and calls `getCurrentRecordingSession()`.
     * Because `finalizeRecordingSession` was called with `webcamPath: null`, `sessionResult.session.webcamPath` is `null`.
     * `useSourceAudioFallback` (`src/components/video-editor/audio/useSourceAudioFallback.ts` line 41) calls `window.electronAPI.getVideoAudioFallbackPaths(currentSourcePath)` on initial render.
     * `useTimelineAudioPeaks` (`src/components/video-editor/timeline/hooks/useTimelineAudioPeaks.ts` line 79) initiates waveform generation for the source media and sidecar audio paths via media server.

4. **Sidecar Conversion and Windows Muxing Mechanism**:
   - In `electron/ipc/register/recording.ts` lines 1606–1753: `storeMicrophoneSidecar` spawns an asynchronous `ffmpeg` process to resample and transcode audio to `recording-<timestamp>.mic.wav` and writes `recording-<timestamp>.mic.wav.json` with `startDelayMs`.
   - In `electron/ipc/project/session.ts` lines 18–42: `persistRecordingSessionManifest` writes `recording-<timestamp>.morec-session.json` only when `session.webcamPath` is present.

5. **Recovery Path Precedent**:
   - In `src/hooks/useScreenRecorder.ts` lines 909–934 (`recoverNativeRecordingSession`):
     ```typescript
     const resolvedMicFallbackBlobPromise = micFallbackBlobPromise ?? stopMicFallbackRecorder();
     const webcamPath = await stopWebcamRecorder();
     await storeMicrophoneSidecar(resolvedMicFallbackBlobPromise, result.path, startDelayMs);
     await finalizeRecordingSession(result.path, webcamPath);
     if (typeof window.electronAPI?.hudOverlayClose === "function") {
         window.electronAPI.hudOverlayClose();
     }
     ```
     The recovery path already coordinates and awaits all companion tasks sequentially before finalizing the session and closing the HUD.

6. **Existing Test Suite Execution**:
   - Running `npm test` via PowerShell executes Vitest:
     `Test Files: 107 passed (107)`, `Tests: 1005 passed | 1 skipped (1006)`.
   - `src/hooks/useScreenRecorder.test.ts` line 307 tests `stopNativeRecordingWithCompanions` where `webcamPathPromise` and `micFallbackBlobPromise` are awaited before returning.

---

## 2. Logic Chain
1. Observations 1 and 2 establish that both native and browser capture stop routines immediately invoke `finalizeRecordingSession(path, null)` and `switchToEditor()`, deferring companion asset processing (`webcamPathPromise`, `storeMicrophoneSidecar`, `muxNativeWindowsRecording`, `setCurrentRecordingSession`) into an unawaited background async IIFE.
2. Observation 3 establishes that the editor window opens immediately and begins indexing session assets (`getCurrentRecordingSession`, `getVideoAudioFallbackPaths`, `useTimelineAudioPeaks`) on its initial mount lifecycle.
3. Because the editor mounts while the unawaited background tasks from Observation 1 are still in flight:
   - The editor initializes with `webcam.sourcePath = null`, omitting the webcam layer from initial timeline clips and preview renderers.
   - `getVideoAudioFallbackPaths` queries the filesystem while `storeMicrophoneSidecar` is still running `ffmpeg` (Observation 4). As a consequence, `.mic.wav` either does not exist yet (missing track) or is partially written (corrupt decode in Web Audio / WaveformGenerator), and `.mic.wav.json` is missing (causing `startDelayMs` audio sync offset loss).
   - On Windows, `muxNativeWindowsRecording` has not executed to move/finalize companion audio.
   - The session manifest `.morec-session.json` is not written on disk when the editor opens.
   - When the unawaited background task finally completes seconds later and dispatches `setCurrentRecordingSession`, it broadcasts `recording-session-changed` mid-session, triggering asynchronous state updates that can cause layout pops, waveform regenerations, or race against user edits.
4. Observation 5 shows that the recovery function `recoverNativeRecordingSession` already implements the correct coordinated pattern (awaiting `stopWebcamRecorder()`, `storeMicrophoneSidecar()`, `finalizeRecordingSession(path, webcamPath)`, then closing the HUD).
5. Therefore, eliminating the unawaited background IIFE in `useScreenRecorder.ts` and awaiting all companion tasks (`webcamPathPromise`, `storeMicrophoneSidecar`, `muxNativeWindowsRecording`) before calling `finalizeRecordingSession(finalPath, webcamPath)` guarantees that all audio/video companion files and metadata are verified and written before the editor mounts, eliminating all race conditions.

---

## 3. Caveats
- No caveats. The recording stop pipelines for macOS ScreenCaptureKit, Windows WGC, and browser MediaRecorder have been fully traced across both renderer (`src/hooks/useScreenRecorder.ts`, `src/components/video-editor/`) and Electron main process (`electron/ipc/register/recording.ts`, `electron/ipc/project/session.ts`, `electron/windows.ts`, `electron/main.ts`).

---

## 4. Conclusion
To satisfy Requirement 3 (R3), the fix must:
1. Refactor `stopRecording` in `src/hooks/useScreenRecorder.ts` (for both native and browser capture paths) to:
   - Concurrently initiate companion stopping (`stopMicFallbackRecorder()`, `stopWebcamRecorder()`).
   - Stop the primary recording backend (`stopNativeScreenRecording()` or main MediaRecorder).
   - Await the webcam path (`await webcamPathPromise`).
   - Await microphone sidecar processing (`await storeMicrophoneSidecar(...)`).
   - Await Windows companion audio handling (`if (isNativeWindows) await window.electronAPI.muxNativeWindowsRecording(...)`).
   - Call `await finalizeRecordingSession(finalPath, webcamPath)` to atomically set the recording session in main process state, write the `.morec-session.json` manifest, and switch to the editor.
   - Call `window.electronAPI.hudOverlayClose()` only after session finalization and editor transition have completed.
2. Update unit tests in `src/hooks/useScreenRecorder.test.ts` to assert that companion promises are awaited and `webcamPath` is passed to `finalizeRecordingSession` before HUD closure.

---

## 5. Verification Method
1. **Automated Unit Tests**:
   - Run `npm test` to verify that all 107 test files pass.
   - Run `npx vitest run src/hooks/useScreenRecorder.test.ts` to verify the recording lifecycle and companion synchronization tests.
2. **Code Inspection**:
   - Inspect `src/hooks/useScreenRecorder.ts` to confirm no unawaited background IIFEs (`void (async () => { ... })()`) exist in `stopRecording`.
   - Verify `finalizeRecordingSession` receives `webcamPath` (not `null`).
   - Verify `hudOverlayClose()` is called after `finalizeRecordingSession` finishes.
3. **Invalidation Conditions**:
   - If the editor window still mounts with `webcamPath: null` when webcam was active.
   - If `getVideoAudioFallbackPaths` is called before `.mic.wav` or `.mic.wav.json` are written to disk.
   - If `npm test` exhibits any regressions.
