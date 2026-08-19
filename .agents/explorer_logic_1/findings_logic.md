# MoRec Pre-Launch Audit: Core Logic, State Management & IPC Findings Catalog

**Audit Scope**: React Hooks & Lifecycle, State Synchronization, Electron IPC, Playback Engine, Media Recording Pipeline, Audio Subsystem, Project Persistence, Export Pipelines, and Resource Cleanup.
**Auditor**: Teamwork Explorer (Core Logic, State Management & IPC Auditor)
**Date**: August 2026
**Target Repository**: MoRec Desktop App (src/ and electron/)

---

## Executive Summary of Findings

| Issue ID | Title | Category | Severity | Primary Target Location | Runtime Impact |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **LOGIC-001** | Unchecked Window Destruction in IPC Countdown Handlers | Electron IPC / Lifecycle | **Critical** | electron/ipc/register/settings.ts:313-326,354-358 | Main Process Uncaught Exception / Crash |
| **LOGIC-002** | 60 FPS React State Dispatch in Canvas Animation Loop | State Sync / Performance | **Major** | src/components/video-editor/VideoPlayback.tsx:498,2364-2378,3323 | Severe UI Frame Drops / CPU Throttling |
| **LOGIC-003** | Synchronous IPC Thread Blocking in Settings Handlers | Electron IPC & Preload | **Major** | electron/preload.ts:931-943, electron/ipc/register/settings.ts:141-174 | Renderer UI Thread Freezes |
| **LOGIC-004** | Missing Timeline-to-Source Time Mapping for Annotation Overlay & Audio | Playback & Export Pipeline | **Critical** | src/components/video-editor/VideoEditor.tsx:3561-3569,6534,6887, VideoPlayback.tsx:3354, modernFrameRenderer.ts:1565 | Desynchronized / Missing Annotations & Audio |
| **LOGIC-005** | Fragile Teardown Cleanup in Screen Recorder Hook | React Hook Lifecycle | **Major** | src/hooks/useScreenRecorder.ts:1306-1404 | Premature Recording Termination |
| **LOGIC-006** | Incomplete Trimming & Movement Normalization for Captions & Annotations | State Management | **Major** | src/components/video-editor/VideoEditor.tsx:4084-4148 | Orphaned Captions / Track Desync |
| **LOGIC-007** | Dual Float32 PCM Duplication & Unbounded Heap in Waveform Generator | Audio Subsystem & Memory | **Major** | src/components/video-editor/audio/waveform/WaveformGenerator.ts:96-105 | Memory Spike (2-4GB) / Renderer OOM Crash |
| **LOGIC-008** | Incomplete History Snapshot Coverage (Captions & Visual Properties) | Project Persistence | **Minor** | src/components/video-editor/editorHistory.ts:11-22, VideoEditor.tsx:1975-2007 | Lost Selection / Inconsistent Undo-Redo |
| **LOGIC-009** | Unbounded Promise in Audio Duration Probe | Audio Subsystem & Async | **Minor** | src/components/video-editor/timeline/hooks/actions/useTimelineAudioActions.ts:39-67 | Indefinite UI Hang on Corrupt Audio |
| **LOGIC-010** | Concurrent Multi-Microphone Stream Acquisition in Popover | Audio Subsystem & Resources | **Minor** | src/components/launch/popovers/PopoverScaffold.tsx:46-50, useAudioLevelMeter.ts:48-60 | Audio Hardware Lock / Resource Contention |
| **LOGIC-011** | Windows Path Slash Mismatch in Recording Session Comparison | Persistence & IPC | **Minor** | src/components/video-editor/projectPersistence.ts:283-312, electron/ipc/utils.ts:31-50, VideoEditor.tsx:2583 | Session Desync / Webcam Not Attached |

---

## Detailed Findings

---

### LOGIC-001: Unchecked Window Destruction in IPC Countdown Handlers

- **Category**: Electron IPC & Window Lifecycle
- **Severity**: **Critical**
- **File**: ile:///e:/New-Personal-Projects/MoRec/electron/ipc/register/settings.ts
- **Line(s)**: 313-326, 354-358

#### 1. Root Cause Analysis & Trigger Scenario
In the start-countdown IPC handler, a child BrowserWindow (countdownWin) is created to display a fullscreen 3-2-1 timer.
1. When start-countdown is invoked, countdownWin.loadURL(...) starts loading the overlay HTML.
2. An interval timer ticks every 1000ms, and a did-finish-load event listener is registered.
3. If the user cancels the countdown (e.g. pressing Escape or invoking cancel-countdown), or if the window is closed while isLoadingMainFrame() is true, calling countdownWin.webContents.send("countdown-tick", remaining) or countdownWin.webContents.send("countdown-start", duration) is executed without checking whether countdownWin or its webContents has already been destroyed (countdownWin.isDestroyed()).
4. Electron throws Error: Object has been destroyed in the main process, resulting in an unhandled promise rejection or application crash.

#### 2. Potential Runtime Impact
- **Main Process Crash / Uncaught Exception**: Cancelling countdown quickly crashes or produces unhandled exceptions in the Electron main process.

#### 3. Recommended Fix
Guard all webContents.send calls with !countdownWin.isDestroyed() && !countdownWin.webContents.isDestroyed(), and ensure timers and event listeners are cleaned up immediately when the window emits "closed" event.

`	ypescript
// In electron/ipc/register/settings.ts:
if (countdownWin && !countdownWin.isDestroyed() && !countdownWin.webContents.isDestroyed()) {
    countdownWin.webContents.send("countdown-tick", remaining);
}
`

---

### LOGIC-002: 60 FPS React State Dispatch in Canvas Animation Loop

- **Category**: State Management & React Rendering Performance
- **Severity**: **Major**
- **File**: ile:///e:/New-Personal-Projects/MoRec/src/components/video-editor/VideoPlayback.tsx
- **Line(s)**: 498, 2364-2378, 3323

#### 1. Root Cause Analysis & Trigger Scenario
In VideoPlayback.tsx, PixiJS drives a continuous 60fps animation ticker loop (pixiApp.ticker.add(...)) that computes camera pan/zoom spring positions.
On lines 2364-2378:
`	ypescript
setAnnotationSceneTransform((prev) => {
    if (
        prev.scale === targetScale &&
        prev.x === targetX &&
        prev.y === targetY
    ) {
        return prev;
    }
    return { scale: targetScale, x: targetX, y: targetY };
});
`
During camera zooms and spring pans, 	argetScale, 	argetX, and 	argetY change on every single animation frame. This triggers setAnnotationSceneTransform (a React useState setter), forcing React to re-render the entire 3500-line VideoPlayback component, recalculate 50+ hooks, re-evaluate all memoized overlays, and reconcile the virtual DOM at 60Hz.

#### 2. Potential Runtime Impact
- **Severe Performance Degradation**: 60 re-renders/sec on the editor component causes frame drops, scrubber input lag, and high CPU usage during zoom previews.

#### 3. Recommended Fix
Decouple annotation container transform from React state. Apply CSS transform directly to the HTML container via overlayRef.current.style.transform =  + String.fromCharCode(96) + 	ranslate(px, px) scale() + String.fromCharCode(96) +  inside the ticker callback without triggering React re-renders.

---

### LOGIC-003: Synchronous IPC Thread Blocking in Settings Handlers

- **Category**: Electron IPC & Preload
- **Severity**: **Major**
- **File**: ile:///e:/New-Personal-Projects/MoRec/electron/preload.ts (lines 931-943) & electron/ipc/register/settings.ts (lines 141-174)

#### 1. Root Cause Analysis & Trigger Scenario
preload.ts defines:
`	ypescript
getAppSetting: (key) => ipcRenderer.sendSync("app-settings:get", key),
setAppSetting: (key, value) => ipcRenderer.sendSync("app-settings:set", key, value),
`
sendSync is a synchronous Electron IPC call. It suspends and blocks the V8 JavaScript renderer thread until the main process handles the message, accesses the settings disk/memory cache, and returns the result. If the main process is busy handling file I/O or native export tasks, the entire renderer UI freezes synchronously.

#### 2. Potential Runtime Impact
- **UI Freezes / Frame Stutter**: Scrubber, timeline interactions, and buttons freeze whenever settings are queried or persisted during user actions.

#### 3. Recommended Fix
Migrate pp-settings:get and pp-settings:set to asynchronous ipcRenderer.invoke handlers (ipcMain.handle). Preload initial settings into the renderer window on startup.
---

### LOGIC-004: Missing Timeline-to-Source Time Mapping for Annotation Overlay & Audio

- **Category**: Playback & Export Pipeline Desynchronization
- **Severity**: **Critical**
- **File**: `file:///e:/New-Personal-Projects/MoRec/src/components/video-editor/VideoEditor.tsx` (lines 3561-3569, 5586, 6534, 6887), `VideoPlayback.tsx` (lines 3354-3358), `modernFrameRenderer.ts` (lines 1565-1570, 3275)

#### 1. Root Cause Analysis & Trigger Scenario
In `VideoEditor.tsx`, user edits (such as trimming the beginning of a clip or splitting clips) introduce a discrepancy between **Timeline Time** (time elapsed on the playback timeline) and **Source Time** (timestamp within the raw source video).
- `zoomRegions` are explicitly mapped from timeline time to source time using `mapTimelineTimeToSourceTime`:
```typescript
const effectiveZoomRegions = useMemo<ZoomRegion[]>(
    () => zoomRegions.map(r => ({
        ...r,
        startMs: mapTimelineTimeToSourceTime(r.startMs),
        endMs: mapTimelineTimeToSourceTime(r.endMs),
    })),
    [zoomRegions, mapTimelineTimeToSourceTime]
);
```
- However, `annotationRegions` and `audioRegions` are created with **Timeline Time** coordinates, but passed directly without mapping to `VideoPlayback` and `modernFrameRenderer`.
- In `VideoPlayback.tsx` (line 3354): `const timeMs = Math.round(currentTime * 1000);` where `currentTime` is the HTMLVideoElement's source time.
- In `modernFrameRenderer.ts` (line 3275): `this.updateAnnotationLayer(timeMs)` where `timeMs` is `sourceTimestampMs`.

If a user trims 5 seconds from the start of a clip and places an annotation at 0s-3s on the timeline:
1. Annotation `startMs` = 0, `endMs` = 3000.
2. During playback, source `currentTime` is 5000ms - 8000ms.
3. The check `timeMs >= ann.startMs && timeMs <= ann.endMs` (`5000 >= 0 && 5000 <= 3000`) is FALSE.
4. The annotation never appears during preview playback or in the exported video.

#### 2. Potential Runtime Impact
- **Desynchronized / Missing Annotations & Audio**: Annotations, arrows, blur boxes, and audio clips appear at incorrect times or vanish completely whenever clips are trimmed or shifted.

3### 3. Recommended Fix
Create `effectiveAnnotationRegions` and `effectiveAudioRegions` in `VideoEditor.tsx` using `mapTimelineTimeToSourceTime` (matching `effectiveZoomRegions`), or pass timeline time down to playback and frame renderers.

---

### LOGIC-005: Fragile Teardown Cleanup in Screen Recorder Hook

- **Category**: React Hook Lifecycle & Recording Stability
- **Severity**: **Major*
- **File**: `file:///e:/New-Personal-Projects/MoRec/src/hooks/useScreenRecorder.ts`
- **Line(s)**: `1306-1404`

#### 1. Root Cause Analysis & Trigger Scenario
In `useScreenRecorder.ts`, an effect registers event listeners for tray commands and recording state:
```typescript
useEFfect(() => {
    ...
    return () => {
        if (nativeScreenRecording.current) {
            nativeScreenRecording.current = false;
            void window.electronAPI.stopNativeScreenRecording();
        }
        const recorder = mediaRecorder.current;
        if (recorder && (recorder.state === "recording" || recorder.state === "paused")) {
            recorder.stop();
        }
        cleanupCapturedMedia();
    };
}, [cleanupCapturedMedia, getRecordingDurationMs, markRecordingResumed, recoverNativeRecordingSession, stopMicFallbackRecorder, stopRecording, stopWebcamRecorder]);
```
`stopRecording` is listed in the dependency array. `stopRecording` depends on `isMacOS` (a state updated asynchronously on mount) and several other callbacks. If any dependency of `stopRecording` changes during recording, the effect teardown executes, stopping the native recording and media recorder prematurely.

#### 2. Potential Runtime Impact
- **Premature Recording Abort / Data Loss**: An ongoing recording is unexpectedly cancelled or cut short due to React re-render dependency invalidation.

#### 3. Recommended Fix
Separate listener registration from component unmount cleanup, or store recording references in stable refs so that listener re-attaching does not invoke active recording teardown methods.

---

### LOGIC-006: Incomplete Trimming & Movement Normalization for Captions & Annotations

- **Category**: State Management & Timeline Synchronization
- **Severity**: **Major**
- **File**: `file:///e:/New-Personal-Projects/MoRec/src/components/video-editor/VideoEditor.tsx`
- **Line(s)**: `4084-4148`

#### 1. Root Cause Analysis & Trigger Scenario
In `handleClipSpanChange`:
1. When a clip is moved (`isMove` is true), only `zoomRegions` are shifted by `delta = startDelta`. `annotationRegions`, `audioRegions`, and `autoCaptions` are not shifted.
2. When a clip is trimmed (`removedSegments.length > 0`), `removeTrimmedRegions` filters `zoomRegions`, `annotationRegions`, `speedRegions`, and `audioRegions`, but completely ignores `autoCaptions`.

#### 2. Potential Runtime Impact
- **Orphaned Captions / Position Desync**: Captions remain placed over deleted video segments or become out of sync with moved clips.

#### 3. Recommended Fix
Include `autoCaptions` in `removeTrimmedRegions` during clip trimming, and establish a uniform movement policy for all timeline track types when clips are shifted.

---


### LOGIC-007: Dual Float32 PCM Duplication & Unbounded Heap in Waveform Generator

- **Category**: Audio Subsystem & Memory Management
- **Severity**: **Major**
- **File**: `file:///e:/New-Personal-Projects/MoRec/src/components/video-editor/audio/waveform/WaveformGenerator.ts`
- **Line(s)**: `96-105`

#### 1. Root Cause Analysis & Trigger Scenario
`WaveformGenerator.generate()` decodes entire media files in the renderer process via `audioContext.decodeAudioData(arrayBuffer)`.
1. `arrayBuffer` holds the entire media file in RAM (~!-2 GB for 4K video).
2. `decodeAudioData` produces uncompressed 32-bit float PCM (~#�3�t"f�"��W"7FW&V��2�Ɩ�W2�C��G�W67&�@�6��7B6���V�3�f��C3$'&�����Ӱ�f�"��WB�����FV6�FVB��V�&W$�d6���V�3�������6���V�2�W6��FV6�FVB�vWD6���V�FF����6Ɩ6R�����Ц �6Ɩ6R�����6FW26V6��BgV���&W6��WF����3�t"6����$�F�G&�6fW"F�F�RvV"v�&�W"�GW&��rF��2&�6W72��V�V��'�7��W2'��fW"2�Rt"�&�6���rc��VW��W7F����B&V�FW&W"7&6�W2ࠣ2222"��FV�F��'V�F��R��7@����&V�FW&W"&�6W72���7&6������v�Ɩ�VƖ���B�b7&6�v�V���F��r���r&V6�&F��w2���V��'��6��7G&��VB7�7FV�2ࠣ22222�&V6���V�FVBf���F�v�6��R�"6��WFR&��6�V�2F�&V7Fǒg&��vWD6���V�FF��6�V�2v�F��WBGWƖ6F��rgV��VF��6���V�'VffW'2��"WF�Ɨ�R6�FV6"VF��f��W2��vf���F�&F�W"F��FV6�F��r�V�F��v�v'�FRf�FV�6��F��W'2��F�R&V�FW&W"ࠢ��Р�222��t�2�����6���WFR��7F�'�6�6��B6�fW&vR�6F���2bf�7V�&�W'F�W2�����6FVv�'����&��V7BW'6�7FV�6Rb��7F�'���vV�V�@����6WfW&�G������֖�w&�"�����f��R���f��S����S���Wr�W'6����&��V7G2���&V2�7&2�6����V�G2�f�FV��VF�F�"�VF�F�$��7F�'��G6�Ɩ�W2�#"�bf�FV�VF�F�"�G7��Ɩ�W2�sR�#r���2222�&��B6W6R�Ǘ6�2bG&�vvW"66V�&��VF�F�$��7F�'�6�6��F�6GW&W26V�V7FVE���ԖF�6V�V7FVD6Ɨ�F�6V�V7FVD���FF���F��B6V�V7FVDVF���F�'WBF�W2��B��6�VFR6V�V7FVD6F���F�v�V�V�F���r6F����W&F���2�7V6�27ƗB�"FV�WFR��6V�V7FVD6F���FV�F�W"&WF��27F�R&VfW&V�6RF�����W��7FV�B6F����B�"f��2F�&W7F�&RF�RW6W"w27F�fR6F���6V�V7F���ࠣ2222"��FV�F��'V�F��R��7@����6V�V7F���FW7��2���7F�R6F���6V�V7F����BgFW"V�F��&VF�7F���2ࠢ22222�&V6���V�FVBf���FB6V�V7FVD6F���C�7G&��r��V�� `F�VF�F�$��7F�'�6�6��F�6���TVF�F�$��7F�'�6�6��F��Bǔ��7F�'�6�6��Fࠢ��Р�222��t�2���V�&�V�FVB&�֗6R��VF��GW&F���&�&P�����6FVv�'����VF��7V'7�7FV�b7��2ƖfV7�6�P����6WfW&�G������֖�w&�"�����f��R���f��S����S���Wr�W'6����&��V7G2���&V2�7&2�6����V�G2�f�FV��VF�F�"�F��VƖ�R�����2�7F���2�W6UF��VƖ�TVF��7F���2�G6 ����Ɩ�R�2����3��cv ��2222�&��B6W6R�Ǘ6�2bG&�vvW"66V�&��FVfV�E&�&TVF��GW&F����67&VFW2&�֗6Rv�F��r����FVF�WFFF�"W'&�&WfV�G2���Wvǒ��7F�F�FVBVF���&�V7B��bF�RVF��f�&�B�2V�7W�'FVB�"F�R�VF�7G&V�7F��2��FVf��FVǒv�F��WBG&�vvW&��rW'&�&�F�R&�֗6R�WfW"6WGF�W2���v��r�7V'6WVV�BVF��FF�F���7F���2ࠢ2222"��FV�F��'V�F��R��7@������FVf��FRT�&��6������&�ƗG�F�FBVF��G&6�2�b&Wf��W2&�&R7F��VBࠢ22222�&V6���V�FVBf���FB�6V6��B6WEF��V�WFf��&6�F�B&W6��fW2F��B6�V�2WF�RVF���&�V7B�b�V�F�W"WfV�Bf�&W2ࠢ��Р�222��t�2��6��7W'&V�B�V�F��֖7&����U7G&V�7V�6�F�������fW �����6FVv�'����VF��7V'7�7FV�b�&Gv&R6��FV�F������6WfW&�G������֖��"�����f��R���f��S����S���Wr�W'6����&��V7G2���&V2�7&2�6����V�G2��V�6����fW'2���fW%66ff��B�G7��Ɩ�W2Cb�S�b7&2�����2�W6TVF���WfV��WFW"�G6�Ɩ�W2C��c���2222�&��B6W6R�Ǘ6�2bG&�vvW"66V�&�����fW%66ff��B�G7��֖4FWf�6U&�v&V�FW'2V6�f��&�R֖7&����R�F����BV�6��F�F����ǒ6��2W6TVF���WfV��WFW"��V�&�VC�G'VR�FWf�6T�C�FWf�6R�FWf�6T�BҖ��bF�RW6W"�2�V�F��RVF����WBFWf�6W26���V7FVB��V��rF�R��fW"&WVW7G26��V�F�V�W2vWEW6W$�VF�7G&V�2�7&VFW2�V�F��RVF��6��FW�F��7F�6W2��B7F'G26��7W'&V�Bcg2&WVW7D��F���g&�V���2ࠢ2222"��FV�F��'V�F��R��7@�����&Gv&R6��FV�F���b&GFW'��5RG&�⢣�&W6�W&6R7��W2�B�FV�F��FWf�6R�'W7�W'&�'2g&��VF��G&�fW'2ࠢ22222�&V6���V�FVBf�����ǒV�&�RF�RVF���WfV��WFW"f�"F�R7W'&V�Fǒ6V�V7FVB�"7F�fR֖7&����RFWf�6R�V�&�VC�6V�V7FVF�ࠢ��Р�222��t�2��v��F�w2F�6�6�֗6�F6���&V6�&F��r6W76���6��&�6�ࠢ���6FVv�'����W'6�7FV�6Rb��2F���&�Ɨ�F������6WfW&�G������֖�w&�"�����f��R���f��S����S���Wr�W'6����&��V7G2���&V2�7&2�6����V�G2�f�FV��VF�F�"�&��V7EW'6�7FV�6R�G6�Ɩ�W2#�2�3"��V�V7G&����2�WF��2�G6�Ɩ�W23�S��f�FV�VF�F�"�G7��Ɩ�R#S�2���2222�&��B6W6R�Ǘ6�2bG&�vvW"66V�&��g&��f��UW&���&��V7EW'6�7FV�6R�G67G&�2f��S�����B&WGW&�2��&�Ɨ�VBF�2v�F�f�'v&B6�6�W2�R���&V2��������6��G&7B�V�V7G&�����&�6W72W6W2��FRw2F��&W6��fV�"f��UU$�F�F��&WGW&��rv��F�w2&6�6�6�W2�S�����&V5������ख�f�FV�VF�F�"�G7��Ɩ�R#S�2���G�W67&�@��b�6W76�����6W76���6�W&6UF���f�FV�6�W&6UF����&WGW&㰧Ц �6��&��r6W76���6�W&6UF��f�'v&B6�6�W2�v�F�f�FV�6�W&6UF��&6�6�6�W2�Wf�VFW2F�f�6R�&WfV�F��rF�R&V6�&F��r6W76���6��vVB��F�W"g&��7��6��rvV&6�&V6�&F��w2ࠣ2222"��FV�F��'V�F��R��7@����vV&6�FW7��6�&�旦F��⢣�vV&6�6�FV6"f��W2f��F�WF��F�6�ǒGF6�W��&V6�&F��r6���WF�����v��F�w2ࠢ22222�&V6���V�FVBf�����&�Ɨ�R��F�2&Vf�&R6��&�6��W6��r6������V�W#���&�Ɨ�UF��������&�Ɨ�UF��"�v�W&R��&�Ɨ�UF����7G&��r����&W�6R�����r�r�r��F���vW$66R���