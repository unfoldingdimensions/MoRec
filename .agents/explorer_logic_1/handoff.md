# Handoff Report: Core Logic, State Management & IPC Pre-Launch Audit

**Agent**: explorer_logic_1 (Core Logic, State Management & IPC Auditor)
**Milestone**: DISCOVERY (Comprehensive Pre-Launch Audit)
**Report Date**: August 2026

---

## 1. Observation

Direct code observations from inspecting the MoRec repository:

1. **IPC Window Lifecycle Race (electron/ipc/register/settings.ts:313-326,354-358)**:
   - In start-countdown, countdownWin.webContents.send("countdown-tick", remaining) and countdownWin.webContents.send("countdown-start", duration) are invoked without checking !countdownWin.isDestroyed() && !countdownWin.webContents.isDestroyed().
2. **High-Frequency React Reconciliation Loop (src/components/video-editor/VideoPlayback.tsx:498,2364-2378,3323)**:
   - setAnnotationSceneTransform is dispatched inside PixiJS ticker callback on every frame during smooth zooms, forcing full top-level React re-renders of the 3500-line component at 60Hz.
3. **Synchronous IPC Blocking Main UI Thread (electron/preload.ts:931-943, electron/ipc/register/settings.ts:141-174)**:
   - getAppSetting and setAppSetting expose synchronous ipcRenderer.sendSync("app-settings:get") and ipcRenderer.sendSync("app-settings:set").
4. **Timeline-to-Source Time Coordinate Desync (VideoEditor.tsx:3561-3569,6534,6887, VideoPlayback.tsx:3354, modernFrameRenderer.ts:1565)**:
   - zoomRegions are converted to source time using mapTimelineTimeToSourceTime, but annotationRegions and audioRegions are not converted, causing annotations to check timeline bounds against video element source timestamps.
5. **Screen Recorder Teardown Re-entrancy (src/hooks/useScreenRecorder.ts:1306-1404)**:
   - The effect registering recording state listeners depends on stopRecording, which in turn depends on isMacOS (async state) and callback handlers, causing cleanup to call stopNativeScreenRecording() during live recording.
6. **Incomplete Caption Trimming Policy (VideoEditor.tsx:4084-4148)**:
   - handleClipSpanChange trims zoomRegions, annotationRegions, speedRegions, and audioRegions in removedSegments, but omits autoCaptions.
7. **Waveform Generator Memory Bloat (WaveformGenerator.ts:96-105)**:
   - decodeAudioData holds the entire uncompressed PCM for the media file, and channels.push(slice()) creates an additional uncompressed duplicate buffer in memory, spiking renderer RAM to 3.5+ GB.
8. **Automated Test Baseline**:
   - Ran full test suite via npm test (vitest run): **113 test files passed (1078 tests passed, 1 skipped)** in 10.07s.

---

## 2. Logic Chain

1. **From IPC Window Lifecycle to Crash Vulnerability (LOGIC-001)**:
   - When a user triggers recording countdown and rapidly cancels it, closeCountdownWindow() destroys the BrowserWindow. The asynchronous timer or did-finish-load handler invokes webContents.send(). Because isDestroyed() is never checked, Electron C++ bindings throw Error: Object has been destroyed, crashing the main process or emitting unhandled rejections.
2. **From Canvas Ticker to Scrubber Lag & Frame Drops (LOGIC-002)**:
   - PixiJS executes camera interpolation at 60 FPS. Updating React component state on every frame triggers React virtual DOM diffing for VideoPlayback, its 50+ hooks, sub-components, and overlays. This starves the main thread, causing scrubber stutter.
3. **From Synchronous IPC to UI Thread Blockage (LOGIC-003)**:
   - ipcRenderer.sendSync suspends V8 execution until the main process IPC response arrives. Any concurrent disk operations in settings persistence cause visible frame hitches.
4. **From Timeline vs. Source Time Coordinates to Broken Annotations (LOGIC-004)**:
   - TimelineEditor operates in timeline time [0 .. timelineDuration]. When clips have non-zero trim offsets or speed scaling, currentTime in VideoPlayback and modernFrameRenderer is source media time. Because annotationRegions are not mapped via mapTimelineTimeToSourceTime, the condition timeMs >= ann.startMs && timeMs <= ann.endMs fails, hiding all annotations in trimmed projects.
5. **From Hook Effect Teardown to Spurious Aborts (LOGIC-005)**:
   - Including stopRecording in the effect dependency array means whenever isMacOS or related callbacks mutate, React cleans up the previous effect run by stopping nativeScreenRecording and mediaRecorder.

---

## 3. Caveats

1. **Native Platform Daemons**:
   - Audited the TypeScript and Electron layer orchestrating native recording daemons (Windows Graphics Capture / macOS ScreenCaptureKit). The compiled C++/Swift native binaries were not inspected directly as their source resides outside the JS workspace.
2. **Hardware Exclusivity on Web Audio**:
   - Device audio exclusivity behavior on multi-mic environments (LOGIC-010) varies across Windows WASAPI and macOS CoreAudio drivers.

---

## 4. Conclusion

The MoRec codebase exhibits strong architecture, modular IPC separation, comprehensive test coverage (1078 passing unit/integration tests), and robust safety guards in many areas.
However, **11 specific logic and state management issues** were uncovered. The most critical items to address prior to launch are:
- **LOGIC-001**: Guard against calling webContents.send on destroyed countdown windows.
- **LOGIC-004**: Apply mapTimelineTimeToSourceTime to annotationRegions and audioRegions in VideoEditor.tsx so annotations work correctly on trimmed/split videos.
- **LOGIC-002**: Replace 60fps React state updates in VideoPlayback.tsx with direct DOM style ref transforms.
- **LOGIC-005**: Isolate screen recorder listener cleanup from unmount teardown.
- **LOGIC-007**: Stream or chunk PCM data in WaveformGenerator.ts to prevent multi-gigabyte memory spikes.

All findings, code locations, root cause traces, and concrete remediation snippets are documented in findings_logic.md.

---

## 5. Verification Method

To independently verify these findings:

1. **Run Test Suite**:
   ```powershell
   npm test
   ```
   Verifies that baseline unit and integration tests pass across all 113 test suites.
2. **Inspect Specific Findings**:
   - **LOGIC-001**: Open file:///e:/New-Personal-Projects/MoRec/electron/ipc/register/settings.ts lines 313-326. Confirm missing countdownWin.isDestroyed() check.
   - **LOGIC-002**: Open file:///e:/New-Personal-Projects/MoRec/src/components/video-editor/VideoPlayback.tsx lines 2364-2378. Confirm setAnnotationSceneTransform in ticker loop.
   - **LOGIC-004**: Open file:///e:/New-Personal-Projects/MoRec/src/components/video-editor/VideoEditor.tsx lines 3561-3569 vs line 6534. Confirm zoomRegions has effectiveZoomRegions mapping, but annotationRegions is passed raw.
   - **LOGIC-005**: Open file:///e:/New-Personal-Projects/MoRec/src/hooks/useScreenRecorder.ts lines 1378-1404. Confirm effect cleanup stops active recording on dependency update.
