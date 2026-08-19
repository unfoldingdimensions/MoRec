# Handoff Report: Requirement 1 (R1) Investigation

## 1. Observation
- **`src/hooks/useScreenRecorder.ts`**:
  - `startRecording()` lines 1504-1565: When `nativeResult.microphoneFallbackRequired && microphoneEnabled`, a browser microphone stream is requested via `navigator.mediaDevices.getUserMedia(microphoneConstraints)`. A `MediaRecorder` instance is stored in `micFallbackRecorder.current` and started with `recorder.start(RECORDER_TIMESLICE_MS)`. Chunks are accumulated in `micFallbackChunks.current`.
  - `cleanupCapturedMedia()` lines 553-596: Contains the disposal logic for `micFallbackRecorder`, calling `micFallbackRecorder.current.stream?.getTracks().forEach((track) => track.stop())` and resetting `micFallbackChunks.current = []` and related diagnostic refs. It also stops tracks on `microphoneStream.current`, `stream.current`, `screenStream.current`, `webcamStream.current`, and closes `mixingContext.current`.
  - `cancelRecording()` lines 2028-2074:
    ```typescript
    const cancelRecording = useCallback(() => {
        if (!recording) return;
        setPaused(false);
        markRecordingResumed(Date.now());

        // Discard webcam recording regardless of recording mode
        webcamChunks.current = [];
        if (webcamRecorder.current && webcamRecorder.current.state !== "inactive") {
            webcamRecorder.current.stop();
        }
        webcamRecorder.current = null;
        webcamStartTime.current = null;
        webcamTimeOffsetMs.current = 0;
        webcamStream.current?.getTracks().forEach((t) => t.stop());
        webcamStream.current = null;
        pendingWebcamPathPromise.current = null;
        resolvedWebcamPath.current = null;

        if (nativeScreenRecording.current) {
            nativeScreenRecording.current = false;
            nativeWindowsRecording.current = false;
            setRecording(false);
            window.electronAPI?.setRecordingState(false);
            void (async () => {
                try {
                    const result = await window.electronAPI.stopNativeScreenRecording();
                    if (result?.path) {
                        await window.electronAPI.deleteRecordingFile(result.path);
                    }
                } catch {
                    // Best-effort cleanup
                }
            })();
            return; // <--- Observation: Returns immediately, skipping cleanupCapturedMedia()
        }

        if (mediaRecorder.current) {
            chunks.current = [];
            cleanupCapturedMedia(); // <--- Observation: Only reached when nativeScreenRecording is false
            if (mediaRecorder.current.state !== "inactive") {
                mediaRecorder.current.stop();
            }
            setRecording(false);
            window.electronAPI?.setRecordingState(false);
        }
    }, [cleanupCapturedMedia, markRecordingResumed, recording]);
    ```
- **`src/hooks/useScreenRecorder.test.ts`**:
  - Mock `cancelRecording` function (lines 334-356) and tests (lines 647-702, 836-848) only checked webcam and standard `recorder.stop()`. They did not simulate or test `micFallbackRecorder` track disposal or audio hardware release in native recording mode.
- **`electron/ipc/register/project.ts`**:
  - `delete-recording-file` (lines 730-761) removes the primary video file and `.telemetry.json`, but does not remove associated sidecar files (`.mic.wav`, `.system.wav`, `.mic.wav.json`, `.system.wav.json`, `.diagnostics.json`, `-webcam.*`) if any were staged.

## 2. Logic Chain
1. During native recordings on Windows or macOS where browser microphone fallback is enabled, `startRecording()` initiates `micFallbackRecorder` using a `MediaStream` acquired via `getUserMedia`.
2. When the user cancels the recording, `cancelRecording()` enters the `if (nativeScreenRecording.current)` block, dispatches the async native process stop, and executes `return;`.
3. Because of the early return, `cleanupCapturedMedia()` is never called.
4. Consequently, `micFallbackRecorder.current` is not stopped, and `.stop()` is never called on the audio `MediaStreamTrack`s attached to `micFallbackRecorder.current.stream`.
5. The underlying Chromium audio input stream remains open, locking the microphone hardware device on the operating system.
6. To fix this defect, `cleanupCapturedMedia()` must be executed unconditionally at the start of `cancelRecording()`, ensuring that `micFallbackRecorder`, its `MediaStreamTrack`s, all other streams (`microphoneStream`, `stream`, `screenStream`), and `mixingContext` are immediately disposed.

## 3. Caveats
- Browser permission queries (`navigator.mediaDevices.getUserMedia`) in test environments must mock `MediaStreamTrack.stop()` and `MediaRecorder.stop()`.
- On Windows native capture, `stopNativeScreenRecording()` may move temporary `.wav` files before returning; `deleteRecordingFile` should defensively clean up matching companion sidecars.
- No caveats regarding the core root cause — the early return in `cancelRecording()` is unambiguous and fully verified.

## 4. Conclusion
The root cause of microphone hardware staying locked upon recording cancellation is the missing call to `cleanupCapturedMedia()` in the `nativeScreenRecording.current` branch of `cancelRecording()` in `src/hooks/useScreenRecorder.ts`.
Fixing this requires:
1. In `src/hooks/useScreenRecorder.ts`, invoke `cleanupCapturedMedia()` unconditionally in `cancelRecording()`.
2. In `cleanupCapturedMedia()`, ensure listeners on `micFallbackRecorder` are detached, all stream tracks stopped, and memory buffers/diagnostics cleared.
3. In `src/hooks/useScreenRecorder.test.ts`, expand unit tests to verify `micFallbackRecorder` and audio track termination upon cancellation.
4. In `electron/ipc/register/project.ts`, enhance `delete-recording-file` to clean up companion audio/webcam/diagnostic sidecars when a recording file is deleted.

## 5. Verification Method
- **Unit test command**: `npm test -- src/hooks/useScreenRecorder.test.ts`
- **Full test suite**: `npm test` (verify 100% tests pass)
- **Files to inspect**:
  - `src/hooks/useScreenRecorder.ts`
  - `src/hooks/useScreenRecorder.test.ts`
  - `electron/ipc/register/project.ts`
- **Invalidation condition**: If `cancelRecording()` is invoked during native recording with fallback microphone enabled, and `micFallbackRecorder.current.stream.getTracks()[0].readyState !== "ended"` (or `track.stop` was not called), the fix is invalid.
