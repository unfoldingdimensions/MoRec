# Project: MoRec Recording Reliability & Audio Lifecycle Fixes

## Architecture
MoRec is an Electron + React/TypeScript screen recording and editing application.
- **Renderer Process (`src/hooks/useScreenRecorder.ts`, `src/components/video-editor/`)**:
  - Manages HUD capture overlay state, recording controls, browser MediaRecorder, fallback microphone capture (`micFallbackRecorder`), and webcam recording (`webcamRecorder`).
  - Orchestrates recording start, pause, resume, cancel, and stop sequences.
  - Interfaces with the Electron main process via `window.electronAPI` bridge.
- **Main Process (`electron/main.ts`, `electron/windows.ts`, `electron/ipc/`)**:
  - Handles window lifecycles (`hudOverlayWindow`, `editorWindow`, `mainWindow`).
  - Manages tray menu interactions and routes IPC messages (e.g. `stop-recording-from-tray`).
  - Handles native recording backends (ScreenCaptureKit on macOS, Windows Graphics Capture on Windows).
  - Handles audio processing, sidecar audio storage (`storeMicrophoneSidecar`, `muxNativeWindowsRecording`), session manifests (`.morec-session.json`), and file deletion (`delete-recording-file`).

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | R1: Audio Stream Cleanup on Cancel | When native/browser recording is cancelled, immediately terminate all fallback microphone streams, MediaStream tracks, sidecars, and clean up hardware locks | M1 | Survey Explorer 1 / ORIGINAL_REQUEST |
| 2 | R2: Reliable Tray Stop Recording Routing | Ensure tray "Stop Recording" menu dispatches reliably to the active HUD overlay capture window regardless of editor window state or mutable `mainWindow` pointers | M2 | Survey Explorer 2 / ORIGINAL_REQUEST |
| 3 | R3: Safe Finalization & Companion Sync | Safely await webcam encoding, mic WAV conversion, and Windows companion audio muxing before mounting editor, preventing race conditions | M3 | Survey Explorer 3 / ORIGINAL_REQUEST |
| 4 | R4: Full Test Suite & Zero Regressions | Verify all 110+ test suites pass with 100% success rate, adding comprehensive unit & integration tests for R1, R2, and R3 | M4 | ORIGINAL_REQUEST |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| 1 | M1: Mic Stream Cleanup on Cancellation (R1) | `src/hooks/useScreenRecorder.ts`, `electron/ipc/register/project.ts`, `src/hooks/useScreenRecorder.test.ts` | none | DONE |
| 2 | M2: Reliable Tray Stop Routing (R2) | `electron/main.ts`, `electron/windows.ts`, `electron/trayRouting.test.ts` | none | DONE |
| 3 | M3: Safe Recording Finalization & Audio/Webcam Sync (R3) | `src/hooks/useScreenRecorder.ts`, `src/hooks/useScreenRecorder.test.ts` | M1 | DONE |
| 4 | M4: Comprehensive Verification & Acceptance | Full test suite (`npm test`), E2E verification, integrity check | M1, M2, M3 | DONE |

## Interface Contracts
### `useScreenRecorder.ts` ↔ Audio Hardware / Stream Lifecycle
- `cleanupCapturedMedia()`: stops all tracks in `micFallbackRecorder.current.stream`, `microphoneStream.current`, `stream.current`, `screenStream.current`, `webcamStream.current`, closes `mixingContext.current`, clears audio buffers.
- `cancelRecording()`: calls `cleanupCapturedMedia()` unconditionally before dispatching native stop.
- `deleteRecordingFile(filePath)`: deletes main recording file and all associated sidecars (`.mic.wav`, `.system.wav`, `.mic.wav.json`, `.system.wav.json`, `.diagnostics.json`, `-webcam.*`).

### Tray Menu ↔ HUD Overlay Window IPC
- `dispatchStopRecordingFromTray()`:
  1. Checks `getHudOverlayWindow()` and sends `stop-recording-from-tray` if valid.
  2. Scans `BrowserWindow.getAllWindows()` for `windowType=hud-overlay`.
  3. Broadcasts to all active windows as fallback.
- Does not rely on `mainWindow` reference which can be `null` after closing editor.

### Recording Finalization ↔ Video Editor Mounting
- `stopRecording()`:
  1. Concurrently stops primary recorder and companion recorders (`stopMicFallbackRecorder`, `stopWebcamRecorder`).
  2. Awaits `webcamPathPromise`.
  3. Awaits `storeMicrophoneSidecar(...)`.
  4. Awaits `muxNativeWindowsRecording(...)` on Windows.
  5. Calls `finalizeRecordingSession(finalPath, webcamPath)`.
  6. Calls `window.electronAPI.hudOverlayClose()` only after session finalization and editor transition have completed.

## Code Layout
- `src/hooks/useScreenRecorder.ts`: Core recording controller hook (R1, R3).
- `src/hooks/useScreenRecorder.test.ts`: Unit and integration tests for recorder hook (R1, R3).
- `electron/main.ts`: Electron application entry, tray menu setup, window routing (R2).
- `electron/windows.ts`: Window management, window tracking, target dispatchers (R2).
- `electron/ipc/register/project.ts`: File deletion and project IPCs (R1 sidecar deletion).
- `electron/ipc/register/project.test.ts`: Sidecar cleanup test suite (R1).
- `electron/trayRouting.test.ts`: Tray routing tests (R2).
