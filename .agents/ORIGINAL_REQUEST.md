# Original User Request

## 2026-08-19T02:50:43Z

Fix the high-priority defects identified in MoRec's screen recording mechanics to prevent audio hardware leaks, restore reliable tray stop controls, and ensure rock-solid recording session finalization without race conditions.

Working directory: e:/New-Personal-Projects/MoRec
Integrity mode: development

## Requirements

### R1. Cleanup and Terminate Microphone Streams on Recording Cancellation
When a native recording session is cancelled, ensure all fallback microphone capture instances, MediaStream audio tracks, and pending sidecar recording buffers are immediately stopped, disposed, and cleaned up to prevent audio input hardware from staying locked in the background.

### R2. Reliable Tray "Stop Recording" Target Routing
Ensure the system tray "Stop Recording" menu action reliably dispatches the stop command to the active HUD overlay capture window regardless of whether an editor window was previously opened, closed, minimized, or destroyed.

### R3. Safe Recording Finalization and Audio/Webcam Synchronization
Ensure the stop recording sequence cleanly handles background tasks (microphone WAV conversion, native Windows audio muxing/moving, and webcam video generation) so that the editor window only mounts with verified, complete audio/video assets and no race conditions occur during timeline initialization.

## Acceptance Criteria

### Audio Resource Cleanup
- [ ] In `useScreenRecorder.ts`, `cancelRecording()` explicitly stops the fallback microphone recorder and calls `stop()` on all audio stream tracks when native recording is active.
- [ ] Microphone hardware indicators (OS privacy icons) turn off immediately upon clicking cancel.

### Tray Menu Reliability
- [ ] Clicking "Stop Recording" in the system tray menu successfully triggers `stopRecording` in the HUD overlay window even after an editor window has been opened and closed.
- [ ] Tray stop routing does not rely on a mutable `mainWindow` reference that becomes `null` or points to an obsolete window.

### Finalization Synchronization & Asset Integrity
- [ ] All companion audio files (`.mic.wav`, `.system.wav`) and webcam files (`-webcam.*`) are completely written, validated, and linked in session metadata before or smoothly as the editor begins playback indexing.
- [ ] Full existing test suite (`npm test`) passes with 100% passing tests and zero regressions.
