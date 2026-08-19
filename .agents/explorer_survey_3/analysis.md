# Requirement 3 (R3) Analysis: Safe Recording Finalization and Audio/Webcam Synchronization

## Executive Summary
This document provides an exhaustive investigation of MoRec's recording stop sequence, post-processing pipelines (microphone WAV sidecar conversion, native Windows audio muxing/moving, and webcam video generation/transcoding), session metadata management, and editor window mounting/initialization.

A critical defect was identified in `src/hooks/useScreenRecorder.ts`: during both native and browser recording stop sequences, the application performs an "optimistic UI" switch to the editor (`finalizeRecordingSession(finalPath, null)` -> `switchToEditor()`) before companion post-processing tasks (webcam encoding/saving, fallback microphone WAV conversion, Windows audio muxing/moving, and session manifest persistence) have finished. This causes a severe race condition where the editor window mounts with missing or incomplete assets (`webcamPath: null`, missing `.mic.wav`, missing `.mic.wav.json` sync metadata), leading to failed audio fallback detection, broken waveform generation, timeline indexing errors, and unpredictable state mutations when late background events fire.

A complete fix strategy and test verification approach are detailed below.

---

## 1. Complete Recording Stop Sequence & Architecture

### 1.1 Trigger Points
1. **HUD Overlay UI**: User clicks the stop button in the HUD overlay, invoking `stopRecording.current()` inside `useScreenRecorder.ts`.
2. **System Tray Menu**: User selects "Stop Recording" from the system tray menu (`electron/main.ts`), which dispatches the `stop-recording-from-tray` IPC event to the capture window.

### 1.2 Stop Pipeline by Capture Mode

#### A. Native Screen Capture (macOS ScreenCaptureKit & Windows WGC)
Located in `src/hooks/useScreenRecorder.ts` (lines 1066–1188):
1. **State Transition**: Sets `recording = false`, `finalizing = true`, marks pause/resume boundaries, and calculates effective recording duration.
2. **Companion Recorders Stop Trigger**:
   - `micFallbackBlobPromise = stopMicFallbackRecorder()`: If browser microphone fallback was active (due to native mic capture unavailability or configuration), flushes remaining audio chunks, stops the `MediaStreamTrack`s, and resolves to a WebM/Opus audio `Blob`.
   - `webcamPathPromise = stopWebcamRecorder()`: If webcam capture was active, stops the webcam `MediaRecorder`, collects video chunks, adjusts duration with `@fix-webm-duration/fix`, and writes the video file to disk via IPC `window.electronAPI.storeRecordedVideo()` (`recording-<timestamp>-webcam.<ext>`).
3. **Native Stop IPC**: Calls `window.electronAPI.stopNativeScreenRecording()`.
   - **On Windows (`electron/ipc/register/recording.ts` line 906)**:
     * Writes `"stop\n"` to the stdin of the native Windows capture executable (`morec-windows-capture.exe`).
     * `waitForWindowsCaptureStop(proc)` awaits process exit (code 0) and captures the output path.
     * Moves temporary video from `%TEMP%/morec-native-<timestamp>.mp4` to the destination `recording-<timestamp>.mp4`.
     * Moves temporary system audio (`.system.wav`) and temporary mic audio (`.mic.wav`) to final companion paths alongside the video.
     * Validates video output via `validateRecordedVideo()` (checks file exists, size >= 1024 bytes, ffprobe decode frame 1, duration > 0).
     * Snapshots and persists cursor telemetry via `snapshotCursorTelemetryForPersistence()` and `persistPendingCursorTelemetry(finalVideoPath)`.
     * Sets `windowsPendingVideoPath(finalVideoPath)`.
     * Returns `{ success: true, path: finalVideoPath }`.
   - **On macOS (`electron/ipc/register/recording.ts` line 906, `electron/ipc/recording/mac.ts` line 81)**:
     * Writes `"stop\n"` to the ScreenCaptureKit helper process stdin.
     * `waitForNativeCaptureStop(proc)` awaits helper completion.
     * Moves temporary video to final destination `recording-<timestamp>.mp4`.
     * Moves separate system audio (`.system.m4a`) and mic audio (`.mic.m4a`) to companion paths via `muxNativeMacRecordingWithAudio()`.
     * Calls `finalizeStoredVideo()` -> validates video, persists cursor telemetry, prunes older auto-recordings, returns `{ success: true, path: finalVideoPath }`.

4. **Post-Processing & Sidecar Generation**:
   - **Microphone WAV sidecar conversion** (`electron/ipc/register/recording.ts` line 1606): `storeMicrophoneSidecar` receives the fallback audio `ArrayBuffer`, writes to a temporary file, executes `ffmpeg` with audio filters (`aresample=async=1:first_pts=0`, `pcm_s16le`, 48kHz mono WAV) to output `recording-<timestamp>.mic.wav`, and writes `recording-<timestamp>.mic.wav.json` metadata containing `startDelayMs`, `browserMicrophoneProfile`, chunk events, and pause intervals.
   - **Native Windows Audio Sidecars**: `muxNativeWindowsRecording` (`electron/ipc/register/recording.ts` line 1411, `electron/ipc/recording/windows.ts` line 199) moves `.system.wav` and `.mic.wav` if not already moved, records diagnostics snapshots, and cleans up temporary files.
   - **Webcam Video**: `webcamPathPromise` completes the disk write and returns `recording-<timestamp>-webcam.<ext>`.
   - **Session Manifest Persistence**: `setCurrentRecordingSession` (`electron/ipc/register/project.ts` line 671, `electron/ipc/project/session.ts` line 18) writes `recording-<timestamp>.morec-session.json` linking `videoFileName`, `webcamFileName`, `timeOffsetMs`, and `hideOverlayCursorByDefault`.

#### B. Browser Screen Capture (HTML5 MediaRecorder)
Located in `src/hooks/useScreenRecorder.ts` (lines 1820–1900):
1. Flushes remaining chunks and stops the main screen `MediaRecorder`.
2. Gathers chunks into a `Blob`, runs `fixWebmDuration` to correct WebM container duration headers, converts to `ArrayBuffer`, and writes to disk via `window.electronAPI.storeRecordedVideo(arrayBuffer, videoFileName)`.
3. Concurrently, `webcamStopPromise` finalizes and saves the webcam video.
4. Persists recording session manifest and switches to editor.

---

## 2. Session Files Lifecycle, Validation, and Indexing

| File Type | Suffix / Extension | Writer / Origin | Validation & Indexing |
|---|---|---|---|
| **Primary Video** | `recording-<timestamp>.(mp4\|webm)` | Native WGC helper / ScreenCaptureKit / Browser `storeRecordedVideo` | `validateRecordedVideo()`: verifies file exists, size >= 1024 bytes, decodable video stream via ffprobe/ffmpeg, duration > 0. |
| **Microphone Audio** | `recording-<timestamp>.mic.wav` (or `.mic.m4a`) | `storeMicrophoneSidecar` (ffmpeg conversion from browser WebM) or Native WGC / SCK helper | `getCompanionAudioFallbackInfo()`: `fs.stat(micPath).size > 0`; registered in `getVideoAudioFallbackPaths`. |
| **Microphone Metadata** | `recording-<timestamp>.mic.wav.json` | `storeMicrophoneSidecar` | `getCompanionAudioStartDelayMs()`: parsed JSON containing `startDelayMs` for audio preview sync and export alignment. |
| **System Audio** | `recording-<timestamp>.system.wav` (or `.system.m4a`) | Native WGC helper / SCK helper | `getCompanionAudioFallbackInfo()`: `fs.stat(systemPath).size > 0`; registered in `getVideoAudioFallbackPaths`. |
| **Webcam Video** | `recording-<timestamp>-webcam.(webm\|mp4)` | `prepareWebcamRecorder` `onstop` -> `storeRecordedVideo` | `resolveRecordingSession()` / `resolveLinkedWebcamPath()`: checked by filename pattern `^recording-[0-9]+(?:-webcam)?\.(?:webm\|mp4)$` and `fs.access`. |
| **Session Manifest** | `recording-<timestamp>.morec-session.json` | `persistRecordingSessionManifest()` (`setCurrentRecordingSession`) | `resolveRecordingSessionManifest()`: parsed JSON containing `version: 2`, `videoFileName`, `webcamFileName`, `timeOffsetMs`. |
| **Cursor Telemetry** | `recording-<timestamp>.telemetry.json` | `persistPendingCursorTelemetry()` | `get-cursor-telemetry` IPC: parsed JSON array of `CursorTelemetryPoint` samples. |

---

## 3. Detailed Root Cause Analysis: Race Conditions During Finalization

### 3.1 The Flawed "Optimistic UI" Backgrounding
In `src/hooks/useScreenRecorder.ts` (lines 1129–1186 and lines 1858–1885):
```typescript
// CURRENT FLAWED IMPLEMENTATION:
// 1. Finalize the session and switch to editor immediately (Optimistic UI)
await finalizeRecordingSession(finalPath, null);

// 2. Perform background finalization (webcam, muxing, sidecars) - NOT AWAITED!
void (async () => {
    try {
        const webcamPath = await webcamPathPromise;
        await storeMicrophoneSidecar(micFallbackBlobPromise, finalPath, fallbackStartDelayMs, fallbackTrackSettings);
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

### 3.2 Resulting Failure Modes & Race Conditions

1. **Missing / Unrendered Webcam on Editor Mount**:
   - `finalizeRecordingSession(finalPath, null)` sets `webcamPath: null` and opens the editor window.
   - The editor component (`VideoEditor.tsx` lines 2506–2526) mounts and reads `getCurrentRecordingSession()` -> finds `webcamPath: null`.
   - The editor initializes its timeline, clips, and preview with `webcam.enabled = false` and `webcam.sourcePath = null`.
   - When the background task finishes seconds later, `onRecordingSessionChanged` fires, causing an unexpected re-render, layout flash, or loss of webcam state if user interactions have already begun.
   - If the user saves the project immediately after the editor opens, the project is saved without the webcam footage linked.

2. **Microphone Sidecar Race Condition**:
   - `storeMicrophoneSidecar` invokes `ffmpeg` in the main process to transcode the fallback WebM audio buffer into `recording-<timestamp>.mic.wav` and write `recording-<timestamp>.mic.wav.json`.
   - Because the editor opened before this finished, `useSourceAudioFallback` (`useSourceAudioFallback.ts` line 41) immediately invokes `getVideoAudioFallbackPaths(currentSourcePath)`:
     * If ffmpeg has not created `.mic.wav` yet, the query returns no mic audio path.
     * If ffmpeg is in the middle of writing `.mic.wav`, `fs.stat` succeeds but the audio file is corrupt or truncated, causing Web Audio decode errors in `WaveformGenerator.ts` and `useAudioPreviewSync.ts`.
     * If `.mic.wav.json` has not been written yet, `startDelayMs` is missing (`null`), causing mic audio sync drift.

3. **Session Manifest Missing on Disk**:
   - `persistRecordingSessionManifest` is only called inside `setCurrentRecordingSession`. Because `setCurrentRecordingSession` was deferred to the unawaited background task, the manifest file `recording-<timestamp>.morec-session.json` does not exist on disk when the editor loads or if the application is closed early.

4. **Lifecycle & Hardware Leak Danger**:
   - The background task runs in the context of the HUD window (which was hidden via `mainWindow.hide()`).
   - If the user closes the editor window while the HUD is in the middle of background encoding, the Electron process may quit (`window-all-closed`), killing ffmpeg or file writes mid-operation.
   - If the background promise encounters an unhandled rejection, `hudOverlayClose()` might never be called, leaving the hidden HUD window alive and holding system audio/mic hardware hooks.

---

## 4. Existing Test Coverage Analysis

### 4.1 What Tests Currently Exist
- `npm test` runs Vitest across 107 test files (1005 passing tests).
- In `src/hooks/useScreenRecorder.test.ts`:
  * Tests recorder state machine (start, pause, resume, cancel).
  * Line 307 defines a mock test helper `stopNativeRecordingWithCompanions`:
    ```typescript
    const micFallbackBlobPromise = stopMicFallbackRecorder();
    const webcamPathPromise = stopWebcamRecorder();
    const result = await stopNativeScreenRecording();
    const webcamPath = await webcamPathPromise;
    const micFallbackBlob = await micFallbackBlobPromise;
    ```
    This test helper actually demonstrated the correct synchronous pattern (`await webcamPathPromise; await micFallbackBlobPromise;`), proving that the test author anticipated complete companion awaiting, but the actual hook implementation deviated into unawaited backgrounding.
- In `electron/ipc/recording/diagnostics.test.ts`:
  * Tests `getCompanionAudioFallbackInfo`, `getUsableCompanionAudioCandidates`, and `validateRecordedVideo`.
- In `electron/ipc/recording/windows.test.ts`:
  * Tests `muxNativeWindowsVideoWithAudio` audio file moving and structure.

### 4.2 Gaps in Test Coverage
- There are no tests verifying that `useScreenRecorder`'s `stopRecording` function coordinates all companion promises (webcam, mic fallback sidecar, Windows muxing) before finalizing the session and calling `switchToEditor`.
- There are no tests verifying that `finalizeRecordingSession` receives the resolved `webcamPath` rather than `null`.
- There are no tests asserting that `hudOverlayClose` only executes after session persistence and editor switching are complete.

---

## 5. Recommended Fix Strategy for Requirement 3 (R3)

### 5.1 Sequential / Coordinated Stop Finalization in `src/hooks/useScreenRecorder.ts`
1. **In Native Capture Stop Sequence**:
   - Concurrently trigger `micFallbackBlobPromise = stopMicFallbackRecorder()` and `webcamPathPromise = stopWebcamRecorder()`.
   - Call and await `result = await window.electronAPI.stopNativeScreenRecording()`.
   - If native capture failed, handle recovery via `recoverNativeRecordingSession`.
   - Await the webcam result: `const webcamPath = await webcamPathPromise;`.
   - Await fallback microphone storage:
     ```typescript
     await storeMicrophoneSidecar(
         micFallbackBlobPromise,
         finalPath,
         fallbackStartDelayMs,
         fallbackTrackSettings,
     );
     ```
   - On Windows, await native Windows companion audio handling:
     ```typescript
     if (isNativeWindows) {
         await window.electronAPI.muxNativeWindowsRecording(expectedDurationMs);
     }
     ```
   - Call `await finalizeRecordingSession(finalPath, webcamPath)` to atomically persist `setCurrentRecordingSession({ videoPath: finalPath, webcamPath, timeOffsetMs, hideOverlayCursorByDefault })`, write `.morec-session.json`, and open the editor.
   - After finalization and editor opening are complete, safely call `window.electronAPI.hudOverlayClose()`.

2. **In Browser Capture Stop Sequence**:
   - Await `webcamPath = pendingWebcamPathPromise.current ? await pendingWebcamPathPromise.current : resolvedWebcamPath.current;`.
   - Call `await finalizeRecordingSession(finalVideoPath, webcamPath);`.
   - Call `window.electronAPI.hudOverlayClose();`.

### 5.2 Benefits of the Fix
- **Zero Race Conditions**: The editor window mounts only when 100% of video, companion audio (`.system.wav`, `.mic.wav`), metadata (`.json`), webcam (`-webcam.*`), and session manifest files are verified on disk.
- **Immediate Timeline & Waveform Accuracy**: `getVideoAudioFallbackPaths` and `useTimelineAudioPeaks` find complete, non-truncated audio files and exact `startDelayMs` on initial mount without needing late event refreshes.
- **Reliable Webcam Mounting**: Webcam preview and overlay mount on the first frame without layout popping or asynchronous track insertion.
- **Clean Hardware Teardown**: HUD overlay closes only after all ffmpeg conversions and disk writes are complete.

---

## 6. Unit & Integration Test Approach for R3

1. **Unit Tests in `src/hooks/useScreenRecorder.test.ts`**:
   - Add tests verifying that `stopNativeRecordingWithCompanions` and the stop pipeline:
     * Await `webcamPathPromise` before calling session finalization.
     * Pass the resolved `webcamPath` (e.g., `"webcam.webm"`) to `finalizeRecordingSession`.
     * Call `storeMicrophoneSidecar` with the resolved mic fallback blob before editor transition.
     * Invoke `hudOverlayClose` only after session finalization has resolved.
2. **Integration Verification**:
   - Verify `npm test` runs with 100% passing test suite across all 107+ test files with 0 regressions.
