# Recording Lifecycle Review — Windows (hooks scope)

> **Status update (2026-09-14): all findings fixed.** The fix series lives on the same branch as this report (PR #1), one commit per finding, each verified by the real-hook test coverage introduced in the M1 fix. See [Fix status](#fix-status) at the end.

- **Date:** 2026-09-13 · **Reviewed at:** `e6e7aee` (main)
- **Scope:** `src/hooks/useScreenRecorder.ts`, `useScreenRecorder.test.ts`, `useScreenRecorder.lifecycle.test.tsx`, `recordingMimeType.ts`, `useMicrophoneDevices.ts`, `useVideoDevices.ts`, `useAudioLevelMeter.ts`
- **Focus:** start/pause/resume/cancel/stop sequences; R1 (mic-stream cleanup on cancel); R3 finalization ordering (webcam encode → mic sidecar → `muxNativeWindowsRecording` → finalize → `hudOverlayClose`); track leaks; MediaRecorder MIME fallbacks; device hot-plug.
- **Method:** full read of the scoped files; main-process contracts cross-checked only where a finding's severity depends on them (`electron/ipc/register/recording.ts`, `electron/ipc/recording/windows.ts`, `electron/ipc/register/project.ts` delete handler, `src/lib/mediaTiming.ts`). Findings only — no fixes proposed.
- **Verification:** all six scoped test files were run this session: 6 files / 96 tests, all passing.

**No blocker-severity findings.** The primary stop/cancel/recover sequences are correct, and R3's ordering contract holds on all three paths. One major finding concerns test validity rather than runtime behavior; everything else is minor.

---

## Findings

### MAJOR

**M1. The R1/R3 "state machine" and "finalization" tests execute hand-copied replicas, not the hook — `src/hooks/useScreenRecorder.test.ts:176-616`**

Every test in the `stopRecording` / `pauseRecording` / `resumeRecording` / `cancelRecording` / "pause → stop → editor flow" / "safe recording finalization and companion synchronization (R3)" suites calls local functions defined *inside the test file* (`stopRecording` :176, `pauseRecording` :211, `resumeRecording` :240, `stopNativeRecordingWithCompanions` :307, `finalizeNativeRecordingWithCompanions` :334, `finalizeBrowserRecordingWithWebcam` :406, `handleRecordingInterrupted` :441, `cancelRecording` :544). These are manually transcribed copies of `useScreenRecorder.ts` logic; nothing imports the hook except the few pure helpers at :3-9. The only true-hook tests are the 4 browser-path cases in `useScreenRecorder.lifecycle.test.tsx`.

The replicas have *already drifted* from the real code, which proves the risk: the real interrupted handler sets `webcamDiscardRequested` (`useScreenRecorder.ts:1443`), deletes the orphaned webcam companion after failed recovery (:1434-1438), calls `setRecordingState(false)` (:1402), and prompts source re-selection (:1449-1452) — none of which exist in the test replica `handleRecordingInterrupted` (:441-504). Likewise `stopNativeRecordingWithCompanions` (:307-332) omits the `setRecordingState(false)` call and has no `isNativeWindows`/mux parameter at all, while the R3 Windows mux test (:1319-1360) exercises the replica's copy of the ordering, not `useScreenRecorder.ts:1195-1210`.

*Failing-case sketch:* reorder `finalizeRecordingSession` before `storeMicrophoneSidecar`/mux in the real `stopRecording` native path — the entire 1,664-line suite stays green because only the lifecycle file touches the hook, and it has no native-Windows coverage. R4's "zero regressions" assurance for the exact R1/R3 contracts rests on mirrors that cannot fail when the implementation changes.

---

### MINOR

**m1. Native stop-failure path orphans the webcam companion file — `src/hooks/useScreenRecorder.ts:1144-1177`**

When `stopNativeScreenRecording` fails (:1144) and `recoverNativeRecordingSession` returns null or throws (:1151-1167), the function returns after the failure toast. But `webcamPathPromise` (created at :1131) still resolves to a *stored* file: the webcam `onstop` (:1040-1086) runs because `webcamDiscardRequested` is false, stores via `storeRecordedVideo`, and its path resolves an already-abandoned promise. The interrupted handler cleans up exactly this situation (:1434-1438 deletes the orphan webcam and the comment explains why); the stop-failure path has no equivalent.

*Repro sketch:* make the WGC helper exit between the stop request and file validation so `stopNativeScreenRecording` fails and main-side recovery finds nothing usable → user sees "Failed to finish the recording…", and `recording-<ts>-webcam.*` remains on disk, unindexed by any session (the main-side companion sidecars it already moved into the recordings dir are likewise stranded; the `deleteRecordingFile` sweep never runs because no path was returned).

**m2. Webcam track-`ended` handler resolves the stop promise but not the discard flag — `src/hooks/useScreenRecorder.ts:1027-1030`**

On webcam unplug mid-take, the `ended` listener calls `webcamStopResolver.current?.(null)` so finalization can't hang, but it leaves `webcamDiscardRequested.current === false`, leaves the recorder in `recording`, and doesn't clear `webcamChunks`. At the later stop, `stopWebcamRecorder` → `recorder.stop()` → `onstop` sees non-empty chunks and stores the file (:1046-1073); its `webcamStopResolver.current?.(path)` resolves an already-settled promise, so the path is dropped.

*Repro sketch:* unplug the webcam ≥1 encoded frame into a take, keep recording, then stop → session finalizes *without* webcam (correct), but `recording-<ts>-webcam.webm` is written and orphaned. Setting the discard flag in the `ended` handler (as the interrupted handler does at :1443-1444) is the missing piece — reported as a finding only.

**m3. `stopMicFallbackRecorder` leaks the mic stream when the recorder is already inactive — `src/hooks/useScreenRecorder.ts:761-784`**

The early return at :763-767 nulls `micFallbackRecorder.current` and resolves `null` without stopping `recorder.stream` tracks or clearing `micFallbackChunks`. Normal cleanup relies on the recorder's own `onstop` (:777). The fallback recorder is created with no `onerror` (:1660-1677), so a mid-take MediaRecorder error goes unobserved, leaves `state === "inactive"`, and on the native *success* stop path nothing else stops the mic tracks — `cleanupCapturedMedia` is never called after a successful native stop (:1179-1227), so the mic stays captured (OS mic-in-use indicator, hardware lock) until the component unmounts.

*Failing-case sketch:* force a `MediaRecorder` error on the audio fallback recorder mid-take, then stop normally → `ondataavailable`/`onstop` never fire, `stopMicFallbackRecorder` hits the inactive early return, mic track remains live. Also stale `micFallbackChunks` survive into the next session's snapshot refs until `cleanupCapturedMedia` runs.

**m4. Native pause/resume IPC rejections are unhandled — `src/hooks/useScreenRecorder.ts:2111-2135, 2157-2181`**

Both `void (async …)()` IIFEs `await window.electronAPI.pauseNativeScreenRecording()` / `resumeNativeScreenRecording()` with no try/catch. The `result.success === false` path is handled (logs, returns), but an actual IPC rejection (main handler throw, window teardown) becomes an unhandled promise rejection: `paused` state never updates, no toast, webcam/mic-fallback pause never runs. Same shape in the browser stop branch: `window.electronAPI?.setRecordingState(false)` at :1252 is unawaited and unguarded, unlike its native counterpart (:1142, awaited) and the start paths (:1708, :2082, try/catch).

*Failing-case sketch:* mock `pauseNativeScreenRecording` to reject → console unhandled rejection; HUD never enters paused state; clicking stop afterwards still works (pause bookkeeping resumes via `markRecordingResumed` no-op), so impact is a silent no-op pause plus noise.

**m5. Start-window races: `starting` is unexposed and `prepareWebcamRecorder` has no timeout — `src/hooks/useScreenRecorder.ts:1486-1533, 1584-1706, 2287-2311`**

Two related gaps:

1. `prepareWebcamRecorder()` is awaited at :1533 before any capture starts. `getUserMedia` on a wedged Windows UVC driver can hang indefinitely; `startInFlight.current` stays true (:1487-1489, reset only in the `finally` at :2102-2106), so `toggleRecording` is permanently disabled with no surfaced state until app restart.
2. `starting` is intentionally not in `UseScreenRecorderReturn` (:130-154, return object :2287-2311), and `stopRecording`/`cancelRecording` are silent no-ops until the recording flag flips (`:1116` native guard, `:2202` `if (!recording) return`). During the native-start window — which includes a possible mic-permission prompt, since the mic fallback is awaited at :1638-1676 *after* `startNativeScreenRecording` succeeded at :1584-1592 and before `setRecording(true)` at :1706 — the screen is already being captured while the UI reports idle, and a tray stop (`onStopRecordingFromTray` → :1380-1382) or cancel click is swallowed with no feedback; the recording then proceeds.

*Repro sketch (2):* first run with a permission-prompting mic config, start a native Windows recording, immediately click tray Stop during the prompt → no-op; recording continues for the whole take.

**m6. Mic-fallback recorder MIME is hardcoded without a support probe — `src/hooks/useScreenRecorder.ts:1660-1663`**

`new MediaRecorder(micStream, { mimeType: "audio/webm;codecs=opus", … })` skips the `isTypeSupported` probing the screen (:1943, `selectMimeType`) and webcam (:1010, `selectWebcamMimeType`) paths use. If the UA rejects the string, the constructor throws and the *entire* mic fallback aborts with a toast instead of degrading to `audio/webm` or the default. Chromium has shipped opus-in-WebM everywhere, so this is a robustness nit, not an active Windows failure.

**m7. Generic `video/webm` makes the vp8/av1 fallback entries unreachable — `src/hooks/recordingMimeType.ts:1-7`**

`isTypeSupported("video/webm")` is always true in Chromium and `canPlayType("video/webm")` returns `"maybe"`, so the selector at :36-38 always stops at the generic entry; `video/webm;codecs=vp8` and `;codecs=av1` are dead config. Practical consequence: when neither h264 nor vp9 pass the playback gate, the recorder gets the *generic* type and the UA picks its default codec rather than the intended vp8/av1 preference order. Also note `canPlayType` (a *playback* probe) gates the *recording* format choice — on a build where H.264-in-WebM plays but encodes poorly, vp9 is silently preferred. `recordingMimeType.test.ts:29-37` codifies the current behavior as intended.

**m8. `useMicrophoneDevices` has no stale-response guard (the video hook does) — `src/hooks/useMicrophoneDevices.ts:24-103` vs `useVideoDevices.ts:23-30, 68, 91, 101`**

`useVideoDevices` serializes overlapping enumeration with `activeLoadId`; `useMicrophoneDevices` does not. Two rapid `devicechange` events (hot-plug burst) start two `loadDevices` runs; whichever enumeration resolves last wins, so an older result can overwrite a newer device list and `setSelectedDeviceId` computation.

*Repro sketch:* plug in two mics back-to-back; the slower first enumeration (stubbed to resolve after the second) clobbers the list — the newly plugged device disappears from `devices` until the next `devicechange`.

**m9. Label-permission retry flags are inconsistent between the two device hooks — `src/hooks/useMicrophoneDevices.ts:48-50` vs `useVideoDevices.ts:52-65`**

The mic hook sets `hasRequestedMicrophoneLabels = true` *before* awaiting `getUserMedia` (:49-50): a denied prompt permanently disables label fetching for the session — labels stay `Microphone xxxxxxxx` even after the user grants permission and `devicechange` fires. The video hook sets the flag only *after* success (:65), which instead re-prompts on every subsequent `devicechange` after a denial. Both directions mishandle the denied case; they just fail differently.

**m10. `useAudioLevelMeter` never recovers from device hot-unplug — `src/hooks/useAudioLevelMeter.ts:41-95`**

`getUserMedia` failure is caught and logged once (:89-94); there is no `devicechange` listener and no retry, so after the selected mic is unplugged the meter sits at 0 until the `deviceId` prop changes. It also opens a second capture graph on the same mic while a recording may hold the first (fine on Windows shared-mode WDM, but it doubles filter-graph load during recording). Hot-plug recovery gap only; cleanup itself (rAF cancel, track stop, context close at :17-31) is correct, including the in-flight `getUserMedia` race guard at :49-52.

---

## Checked and found sound

- **R3 ordering on all three exit paths** matches webcam → mic sidecar → `muxNativeWindowsRecording` → `finalizeRecordingSession` → `hudOverlayClose`: native stop (`useScreenRecorder.ts:1182-1227`, HUD close in `finally`), recovery (:942-967 — reaches HUD close because `storeMicrophoneSidecar` and `finalizeRecordingSession` cannot reject), interrupted handler (:1404-1430 via `recoverNativeRecordingSession`).
- **R1 cancel cleanup** is thorough: `cancelRecording` (:2201-2259) sets `webcamDiscardRequested`, clears webcam chunks/refs, runs `cleanupCapturedMedia` (:558-606 — all four stream refs, mixing context, fallback recorder with listeners nulled and tracks stopped) before dispatching the native stop, and deletes the native video (main's `delete-recording-file` sweeps `.mic.wav`/`.system.wav`/`-webcam.*` sidecars by basename — verified `electron/ipc/register/project.ts:734+`). Cancel-with-fallback-mic and cancel-while-paused both terminate the mic stream synchronously.
- **Double-invocation idempotence:** `stopRecording`/`cancelRecording` flip their guards synchronously before any await (:1116-1117, :2201-2227, :2244-2246), so double-clicks and tray-vs-HUD races collapse to no-ops.
- **Screen-track loss** auto-stops the take (:1913-1918), and browser stop-from-paused resumes before stopping so the tail chunk is flushed (:1235-1248).
- **Duration math** handles stop-while-paused (`src/lib/mediaTiming.ts:166-195` subtracts the open pause interval), and the webcam offset (`:1628-1631, :2077-2078`) is non-negative and subtracted at encode time (:1051-1054).
- **MIME fallback selector** honors `isTypeSupported` + `canPlayType` with a first-supported last resort and WebM-default extension mapping (`recordingMimeType.ts:25-59`); webcam prefers MP4/H.264 with WebM fallback and only webm blobs go through `fixWebmDuration` (:1060-1062, :1990-1992).
- **Lifecycle tests exercise the real hook** for the browser path (start, mid-take error salvage, cancel-discard, inactive-error discard — `useScreenRecorder.lifecycle.test.tsx:201-306`).

## Test run (this session)

```
Test Files  6 passed (6)
     Tests  96 passed (96)
```
`useScreenRecorder.test.ts` · `useScreenRecorder.lifecycle.test.tsx` · `recordingMimeType.test.ts` · `useMicrophoneDevices.test.tsx` · `useVideoDevices.test.tsx` · `useAudioLevelMeter.test.tsx`

## Fix status

All findings fixed on this branch, one commit each, verified per fix (scoped test runs + `tsc --noEmit` + biome lint per commit; full suite run at the end: 143 files, 1248 passed — the single failure is the author's own untracked `electron/ipc/register/export.stream.test.ts`, unrelated to the hooks).

| Finding | Fix commit | What changed |
| --- | --- | --- |
| M1 replica tests | `38e5215` | `useScreenRecorder.state.test.tsx` drives the real hook through native-Windows/browser paths; replica suites deleted from `useScreenRecorder.test.ts` (pure-helper tests kept) |
| m1 orphaned webcam on stop failure | `bf76bd3` | stop-failure path deletes the stored webcam companion, mirroring the interrupted handler |
| m2 webcam `ended` orphan file | `278be13` | `ended` handler sets `webcamDiscardRequested` and clears chunks |
| m3 mic-fallback leak on errored recorder | `429f99d` | inactive-recorder early return stops its stream and clears chunks; `onerror` added for observability |
| m4 pause/resume IPC rejections | `e4ac977` | try/catch around native pause/resume IPC; guarded fire-and-forget `setRecordingState(false)` in the browser stop branch |
| m5 start-window wedge | `2da2ca6` | `starting` exposed on the hook contract; 10 s device-request timeout on webcam `getUserMedia` with late-resolution hardware release |
| m6 hardcoded mic MIME | `77c24d6` | `selectMicrophoneRecordingMimeType` probe (opus → generic WebM audio → recorder default) |
| m7 unreachable vp8/av1 fallbacks | `5fc56a6` | generic `video/webm` ranked last in the preference list |
| m8 stale mic enumerations | `f3f7fe0` | `activeLoadId` guard mirrored from the video hook |
| m9 label-permission retry divergence | `b18317f` | unified contract in both device hooks: denial consumes the session flag, transient failures stay retryable, success consumes it after the probe |
| m10 meter dies on unplug | `d43b7e5` | devicechange teardown/reopen of the capture graph, with a session token guarding overlapping acquisitions |

Known follow-ups left open deliberately: exposing `starting` to the UI (the hook contract now carries it; HUD/LaunchWindow wiring belongs to the renderer UI/UX fix pass), and the pre-existing `useExhaustiveDependencies` warning on `toggleRecording` (present before this series; wrapping `startRecording` in `useCallback` is a small refactor beyond this scope).
