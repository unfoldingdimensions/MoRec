# Review & Adversarial Critic Report: Milestone 1 (R1 - Audio Hardware Leaks & Stream Cleanup on Cancellation)

**Reviewer**: Reviewer 1 (`reviewer_m1_1`)  
**Verdict**: **APPROVE**  
**Overall Risk Assessment**: LOW  

---

## 1. Observation

Direct code inspections and execution results:

1. **`src/hooks/useScreenRecorder.ts`**:
   - `cleanupCapturedMedia()` (lines 553–601):
     - Synchronously stops all tracks on `stream.current`, `screenStream.current`, `microphoneStream.current`, and `webcamStream.current`.
     - Nulls stream references to enable garbage collection.
     - Closes `mixingContext.current` with `.catch(() => undefined)` and nulls the reference.
     - Detaches event listeners on `micFallbackRecorder.current` (`ondataavailable = null`, `onstop = null`, `onerror = null`), stops the recorder if state is not `"inactive"`, and stops all underlying `MediaStreamTrack`s via `micFallbackRecorder.current.stream?.getTracks().forEach((track) => track.stop())`. All recorder operations are wrapped in `try-catch` to guard against unexpected runtime recorder exceptions.
     - Resets `micFallbackChunks.current = []`, metadata, constraints, and timing diagnostics.
   - `cancelRecording()` (lines 2033–2089):
     - Unconditionally calls `cleanupCapturedMedia()` (line 2056) at the beginning of cancellation before deciding between native (`nativeScreenRecording.current`) and browser recording paths.
     - Discards webcam buffers, stops webcam recorder, stops webcam stream tracks, and clears pending promises.
     - Dispatches native stop and calls `window.electronAPI.deleteRecordingFile(result.path)` when native recording is active.
     - Correctly resets recording states (`nativeScreenRecording.current = false`, `nativeWindowsRecording.current = false`, `setRecording(false)`, `window.electronAPI.setRecordingState(false)`).

2. **`electron/ipc/register/project.ts`**:
   - `delete-recording-file` IPC handler (lines 734–815):
     - Enforces security checks using `isPathInsideDirectory` and `isAutoRecordingPath` before unlinking.
     - Unlinks the main video file and cursor telemetry file.
     - Iterates through a comprehensive list of companion sidecars: `.mic.wav`, `.mic.wav.json`, `.system.wav`, `.system.wav.json`, `.mic.m4a`, `.mic.m4a.json`, `.system.m4a`, `.system.m4a.json`, `.mic.webm`, `.mic.webm.json`, `.system.webm`, `.system.webm.json`, `.mic.source.webm`, `.mic.source.webm.tmp`, `.diagnostics.json`, `.recording-diagnostics.json`, `.cursor.json`, `.telemetry.json`, and `.morec-session.json`.
     - Deletes both `${baseWithoutExt}${suffix}` and `${resolvedPath}${suffix}` variants.
     - Inspects directory for webcam assets matching prefix `${baseName}-webcam` and unlinks matching artifacts.
     - All `fs.unlink` operations are catch-guarded with `.catch(() => undefined)` to guarantee atomic best-effort cleanup without throwing unhandled rejections.

3. **`src/hooks/useScreenRecorder.test.ts`**:
   - Implemented `createMockMediaTrack`, `createMockMediaStream`, and `createMockFallbackRecorder`.
   - Added 5 unit tests verifying native recording cancellation with fallback mic, simultaneous webcam + fallback mic cancellation, standard browser recording cancellation with AudioContext mixing, inactive fallback recorder handling, and recorder stop exception resilience.

4. **Integrity & Independent Verification Results**:
   - `npx vitest run src/hooks/useScreenRecorder.test.ts`: **58/58 passed** in 22ms.
   - `npx tsc --noEmit`: **0 errors**.
   - `npm test`: **107 test files passed, 1010 passed, 0 failed, 1 skipped**.
   - No hardcoded shortcuts, facade implementations, or integrity violations detected.

---

## 2. Logic Chain

1. **Root Cause**: Previously, `cancelRecording()` had an early exit for native recordings (`if (nativeScreenRecording.current) { ... return; }`) that ran before `cleanupCapturedMedia()`. As a result, fallback microphone streams (`MediaStreamTrack`s acquired via `getUserMedia`) remained active and locked at the OS driver level.
2. **Remediation**: Moving `cleanupCapturedMedia()` to execute unconditionally at the start of `cancelRecording()` guarantees that all active tracks (mic fallback, webcam, screen, mixed stream) are explicitly terminated via `track.stop()`, listeners are nulled to prevent dangling events, and memory buffers are cleared before any asynchronous IPC calls are dispatched.
3. **Sidecar Cleanup**: Native recording cancellation triggers `stopNativeScreenRecording()`, which returns a temporary file path passed to `deleteRecordingFile()`. The enhanced sidecar cleanup logic guarantees that intermediate companion audio (`.mic.wav`, `.system.wav`), telemetry, diagnostics, and companion webcam files are systematically removed from disk, preventing stale or leaked recording assets.
4. **Adversarial & Exception Resilience**: All track and recorder stops are guarded by `try-catch` and `readyState` / `state` inspections, ensuring that errors or closed streams do not break subsequent teardown steps.

---

## 3. Caveats

- OS-level driver hardware locks are dependent on the underlying Chromium browser engine properly honouring `MediaStreamTrack.stop()`, which is standard Chromium behavior across Windows and macOS.
- `delete-recording-file` intentionally restricts deletions to paths strictly within the recordings directory matching `isAutoRecordingPath` to prevent arbitrary file deletion risks.

---

## 4. Conclusion

The implementation for Milestone 1 (R1 - Audio Hardware Leaks & Stream Cleanup on Cancellation) is complete, robust, and correctly addresses all requirements in `ORIGINAL_REQUEST.md` and `PROJECT.md`. No regressions were introduced, and all tests pass with 100% success rate.

**Verdict: APPROVE**

---

## 5. Verification Method

To independently reproduce the verification results:

```bash
# 1. Run the recorder unit tests
npx vitest run src/hooks/useScreenRecorder.test.ts

# 2. Verify TypeScript type correctness
npx tsc --noEmit

# 3. Run the entire test suite
npm test
```
