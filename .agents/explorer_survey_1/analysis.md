# Requirement 1 (R1) Deep-Dive Investigation Report
## Cleanup and Terminate Microphone Streams on Recording Cancellation

### Executive Summary
When a screen recording session is cancelled in MoRec, if native recording is active (macOS ScreenCaptureKit or Windows Graphics Capture with browser fallback microphone), the microphone hardware remains active and locked in the background. The root cause is an early `return` in `useScreenRecorder.ts:cancelRecording()` that completely bypasses `cleanupCapturedMedia()`, leaving the `micFallbackRecorder` running and its underlying `MediaStreamTrack` audio instances unstopped.

---

### 1. Problem Statement & Background
MoRec supports native recording pipelines on macOS (ScreenCaptureKit) and Windows (Windows Graphics Capture). On both platforms, when native microphone capture is unavailable or disabled in the native helper (notably on Windows WGC where the browser fallback is frequently used for high quality audio processing/AGC), MoRec falls back to capturing microphone audio in the renderer process via `navigator.mediaDevices.getUserMedia()`, driving a secondary `micFallbackRecorder` (MediaRecorder) to produce a companion `.mic.wav` sidecar audio track.

When a user cancels a recording in progress (via HUD UI or shortcuts):
- Active recording must be stopped and discarded.
- All hardware streams (Microphone, Camera, Screen) and intermediate buffers must be immediately released.
- However, currently, the microphone input hardware remains locked and active indefinitely.

---

### 2. Codebase Architecture & Key Files

| File Path | Role / Key Functions |
|---|---|
| `src/hooks/useScreenRecorder.ts` | Central React hook managing recording state machine, MediaRecorder instances, fallback microphone capture, webcam capture, stream tracks, and IPC coordination (`startRecording`, `stopRecording`, `cancelRecording`, `cleanupCapturedMedia`, `stopMicFallbackRecorder`, `storeMicrophoneSidecar`). |
| `src/hooks/useScreenRecorder.test.ts` | Unit test suite for `useScreenRecorder` helper functions, options, and recording state machine (`stopRecording`, `pauseRecording`, `resumeRecording`, `cancelRecording`). |
| `src/components/launch/RecordingControls.tsx` | HUD UI controls during recording; dispatches `onCancelRecording` to `cancelRecording` when clicking the 'X' button (lines 128-137). |
| `src/components/launch/LaunchWindow.tsx` | Main HUD launcher component integrating `useScreenRecorder` and passing `cancelRecording` to `RecordingControls` (lines 67, 218). |
| `electron/ipc/register/recording.ts` | Main process IPC handlers: `start-native-screen-recording`, `stop-native-screen-recording`, `store-microphone-sidecar`. |
| `electron/ipc/register/project.ts` | Main process IPC handler `delete-recording-file` (lines 730-761). |
| `electron/ipc/recording/windows.ts` | Windows Graphics Capture process lifecycle and audio muxing. |
| `electron/ipc/recording/mac.ts` | macOS ScreenCaptureKit lifecycle and companion audio muxing. |

---

### 3. Lifecycle States & Call Chain Analysis

#### 3.1 Starting a Recording (`startRecording()`, lines 1355-1934)
1. **Webcam Preparation**: `await prepareWebcamRecorder()` acquires `webcamStream.current = await navigator.mediaDevices.getUserMedia(...)` and instantiates `webcamRecorder.current`.
2. **Native Recording Check**: If macOS or Windows native capture is chosen:
   - IPC `startNativeScreenRecording(selectedSource, options)` is called.
   - If `nativeResult.success` and `nativeResult.microphoneFallbackRequired && microphoneEnabled` (lines 1504-1565):
     - Acquires `micStream = await navigator.mediaDevices.getUserMedia(microphoneConstraints)`.
     - Captures snapshot settings in `micFallbackTrackSettings.current`.
     - Instantiates `micFallbackRecorder.current = new MediaRecorder(micStream, { mimeType: "audio/webm;codecs=opus", audioBitsPerSecond: AUDIO_BITRATE_VOICE })`.
     - Attaches `ondataavailable = appendMicFallbackChunk`.
     - Starts `micFallbackRecorder.current.start(RECORDER_TIMESLICE_MS)`.
     - Sets `nativeScreenRecording.current = true`.
3. **Standard Browser Recording Fallback**:
   - `screenStream.current` acquired via `getUserMedia`/`getDisplayMedia`.
   - `microphoneStream.current` acquired via `getUserMedia`.
   - Audio tracks mixed in `mixingContext.current` (AudioContext).
   - `mediaRecorder.current` started on `stream.current`.

#### 3.2 Stopping a Recording Normally (`stopRecording.current()`, lines 1066-1213)
- In native mode:
  - Invokes `const micFallbackBlobPromise = stopMicFallbackRecorder();` (line 1082).
  - In `stopMicFallbackRecorder()` (lines 738-761):
    - Sets `recorder.onstop` to stop all tracks: `recorder.stream.getTracks().forEach((track) => track.stop())`.
    - Resets `micFallbackChunks.current = []`.
    - Calls `recorder.stop()`.
  - Invokes `stopWebcamRecorder()`.
  - Calls IPC `stopNativeScreenRecording()`.
  - Saves the fallback microphone sidecar to disk via `storeMicrophoneSidecar()`.

#### 3.3 Cancelling a Recording (`cancelRecording()`, lines 2028-2074)
```typescript
2028: const cancelRecording = useCallback(() => {
2029:     if (!recording) return;
2030:     setPaused(false);
2031:     markRecordingResumed(Date.now());
2032:
2033:     // Discard webcam recording regardless of recording mode
2034:     webcamChunks.current = [];
2035:     if (webcamRecorder.current && webcamRecorder.current.state !== "inactive") {
2036:         webcamRecorder.current.stop();
2037:     }
2038:     webcamRecorder.current = null;
2039:     webcamStartTime.current = null;
2040:     webcamTimeOffsetMs.current = 0;
2041:     webcamStream.current?.getTracks().forEach((t) => t.stop());
2042:     webcamStream.current = null;
2043:     pendingWebcamPathPromise.current = null;
2044:     resolvedWebcamPath.current = null;
2045:
2046:     if (nativeScreenRecording.current) {
2047:         nativeScreenRecording.current = false;
2048:         nativeWindowsRecording.current = false;
2049:         setRecording(false);
2050:         window.electronAPI?.setRecordingState(false);
2051:         void (async () => {
2052:             try {
2053:                 const result = await window.electronAPI.stopNativeScreenRecording();
2054:                 if (result?.path) {
2055:                     await window.electronAPI.deleteRecordingFile(result.path);
2056:                 }
2057:             } catch {
2058:                 // Best-effort cleanup
2059:             }
2060:         })();
2061:         return; // <--- CRITICAL BUG: Exits early without calling cleanupCapturedMedia()!
2062:     }
2063:
2064:     if (mediaRecorder.current) {
2065:         chunks.current = [];
2066:         cleanupCapturedMedia(); // <--- Only called for browser mediaRecorder!
2067:         if (mediaRecorder.current.state !== "inactive") {
2068:             mediaRecorder.current.stop();
2069:         }
2070:         setRecording(false);
2071:         window.electronAPI?.setRecordingState(false);
2072:     }
2073: }, [cleanupCapturedMedia, markRecordingResumed, recording]);
```

---

### 4. Root Cause Analysis

1. **Early Return Bypasses Media Cleanup in Native Mode**:
   When `nativeScreenRecording.current` is true, `cancelRecording()` sets boolean flags, dispatches IPC `stopNativeScreenRecording()`, and immediately executes `return;` at line 2061.
2. **Fallback Microphone Stream & Recorder Left Running**:
   Because `cleanupCapturedMedia()` is never reached:
   - `micFallbackRecorder.current` remains active (state: `"recording"`).
   - `micFallbackRecorder.current.stream.getTracks()` (the microphone `MediaStreamTrack` instances) are never stopped with `.stop()`.
   - Audio data chunks continue to be collected into `micFallbackChunks.current` in memory.
   - `micFallbackTrackSettings.current`, `micFallbackRequestedConstraints.current`, `micFallbackAudioInputDevices.current`, and `micFallbackRecorderMetadata.current` are never reset.
3. **Audio Hardware Remains Locked by the OS**:
   In Chromium/Electron, until every `MediaStreamTrack` associated with an audio input device is explicitly `.stop()`-ped, the browser keeps the device handle open. The OS (Windows CoreAudio / WASAPI or macOS CoreAudio) maintains the active microphone session, keeping the microphone recording indicator (LED, taskbar icon) illuminated and preventing other exclusive modes or energy saving sleep states.
4. **Conditional Execution in Standard Mode**:
   In standard browser recording, `cleanupCapturedMedia()` is nested inside `if (mediaRecorder.current)`. If `mediaRecorder.current` was somehow nullified or uninitialized during an aborted start, `cleanupCapturedMedia()` would also be skipped.

---

### 5. Detailed Fix Strategy for R1

#### 5.1 Update `useScreenRecorder.ts`
1. **Unconditional Cleanup in `cancelRecording()`**:
   Call `cleanupCapturedMedia()` at the very top of `cancelRecording()`, before branching on `nativeScreenRecording.current` vs `mediaRecorder.current`.
2. **Defensive `cleanupCapturedMedia()` Implementation**:
   Ensure `cleanupCapturedMedia()` comprehensively stops and disposes:
   - `micFallbackRecorder.current`:
     - Detach event listeners: `ondataavailable = null`, `onstop = null`, `onerror = null`.
     - Stop if `state !== "inactive"`.
     - Stop all tracks: `micFallbackRecorder.current.stream?.getTracks().forEach((track) => track.stop())`.
     - Clear `micFallbackRecorder.current = null`.
     - Clear `micFallbackChunks.current = []`.
     - Clear diagnostic refs (`micFallbackTrackSettings.current = null`, `micFallbackRequestedConstraints.current = null`, `micFallbackAudioInputDevices.current = null`, `micFallbackRecorderMetadata.current = null`, `resetMicFallbackTimingDiagnostics()`).
   - `microphoneStream.current`: `getTracks().forEach((track) => track.stop())`, `microphoneStream.current = null`.
   - `stream.current`: `getTracks().forEach((track) => track.stop())`, `stream.current = null`.
   - `screenStream.current`: `getTracks().forEach((track) => track.stop())`, `screenStream.current = null`.
   - `webcamStream.current`: `getTracks().forEach((track) => track.stop())`, `webcamStream.current = null`.
   - `mixingContext.current`: close and set to `null`.
   - `mediaRecorder.current`: stop if active, clear `chunks.current = []`, set to `null`.

#### 5.2 Enhance `delete-recording-file` in `electron/ipc/register/project.ts`
When `deleteRecordingFile(filePath)` is called after native cancellation:
- Delete base file (`.mp4`, `.webm`, `.mov`).
- Delete companion audio sidecars if created: `.system.wav`, `.mic.wav`, `.system.wav.json`, `.mic.wav.json`, `.system.m4a`, `.mic.m4a`, `.mic.source.webm`.
- Delete companion webcam video if created: `-webcam.webm`, `-webcam.mp4`, `-webcam.mov`.
- Delete telemetry file: `.telemetry.json`.
- Delete diagnostics file: `.diagnostics.json`.

---

### 6. Test Strategy for R1

#### 6.1 Unit Tests in `src/hooks/useScreenRecorder.test.ts`
Update `useScreenRecorder.test.ts` to mock and assert track stopping and fallback microphone recorder disposal:
1. **Cancel Native Recording with Fallback Microphone**:
   - Given a native recording session where `micFallbackRecorder` has active audio tracks and chunk buffers.
   - When `cancelRecording()` is called.
   - Assert:
     - `micFallbackRecorder.stop()` was called.
     - `track.stop()` was called on all audio tracks of `micFallbackRecorder.stream`.
     - `micFallbackChunks.current` is emptied.
     - `micFallbackTrackSettings` and timing diagnostics are reset.
     - Native stop IPC is invoked and recorded file is deleted.
2. **Cancel Standard Recording with Microphone**:
   - Given a standard browser recording session with `microphoneStream` and `screenStream`.
   - When `cancelRecording()` is called.
   - Assert:
     - All audio tracks on `microphoneStream` and `screenStream` have `stop()` called.
     - `mediaRecorder.stop()` was called.
     - `chunks.current` is emptied.
3. **Cancel Inactive/Edge States**:
   - Verify calling `cancelRecording()` when streams are already stopped or null does not throw.
4. **Error Handling during Native Stop Cancellation**:
   - Verify that if `window.electronAPI.stopNativeScreenRecording()` rejects during cancellation, all renderer-side microphone tracks and fallback recorders are already stopped and cleaned up synchronously.
