> **Status (2026-09-17):** Resolved. H1–H3, M1–M5 and L1/L3–L5 were fixed in PR #25 (live-verified on real Windows spawns/displays). **L2** (busy/custom cursor mapping) is deferred — it needs a new cursor design asset pushed through the telemetry whitelist and renderer cursor stack. Consolidated to main from review PR #6 before closing it; this file is the record copy.

# Windows native layer review — findings only

**Date:** 2026-09-13 · **Review base:** `main@e6e7aee` · **Delivered as:** findings-only PR, nothing implemented until approved.

**Scope:** `electron/native/` (wgc-capture, cursor-monitor + build scripts), `electron/ipc/windowsCaptureSelection.ts`, `electron/ipc/monitorResolver.ts`, `electron/ipc/cursor/` (bounds, monitor, interaction, telemetry), `electron/hudOverlayBounds.ts`, `electron/cursorHider.ts`, `electron/gpuSwitches.ts`, `electron/trayRouting.test.ts` + adversarial suite, `scripts/build-windows-capture.mjs`, `scripts/build-cursor-monitor.mjs`, plus the consumers needed to trace real behavior (`electron/ipc/register/recording.ts`, `electron/windows.ts`, `electron/main.ts` tray wiring, `src/hooks/useScreenRecorder.ts` tray listener).

**Checks requested:** Graphics Capture source/monitor selection errors · multi-DPI/monitor edge cases · cursor telemetry accuracy · HUD overlay bounds / tray-stop routing reliability (R2 mainWindow-null case) · uiohook-napi rebuild risk · GPU switch side effects.

**Method:** full read of the scoped files and native sources, plus empirical probes run on this Windows machine (Win11, 2560×1440 @ 125%):

- **Probe A (PowerShell DPI awareness):** `GetProcessDpiAwareness` in the exact `powershell.exe -NoProfile -NonInteractive -Command` shape the app uses → **`PROCESS_DPI_UNAWARE` (0)**; `EnumDisplayMonitors` rects report `0,0,2048×1152` while the physical mode is 2560×1440 → DPI-unaware coordinates are physical × 96/system-DPI.
- **Probe B (Electron screen):** repo Electron reports primary `bounds 0,0,2048×1152, scaleFactor 1.25, id 189667873` → Electron's coordinates are DIPs and its display **id is a Chromium hash, not an HMONITOR** (the HMONITOR value seen by Probe A was `65537`).
- **Probe C (PowerShell `-Command` argument binding):** `powershell.exe -NoProfile -Command "param([string]$p1, [string]$p2) …" AAA BBB` does **not** bind the trailing args — the script runs with empty params, then `AAA`/`BBB` execute as extra commands.
- **Probe D (PE subsystem):** shipped `bin/win32-x64/wgc-capture.exe` and `cursor-monitor.exe` are both **subsystem 3 (console)**, not GUI.

All unit tests in scope pass as of this review (`55 tests / 8 files`, vitest run this session); every finding below is a gap the current tests cannot see.

---

## Severity summary

| # | Severity | Area | Finding |
|---|----------|------|---------|
| H1 | High | Cursor telemetry | Window-bounds PowerShell bridge never returns bounds → window-capture cursor telemetry normalized against the wrong region; per-second PowerShell churn during window recordings |
| H2 | High | Native helpers | Both helpers are console-subsystem exes spawned without `windowsHide` → visible console windows on every recording |
| H3 | High | Capture selection | Mixed-DPI multi-monitor: secondary display capture fails or can silently record the wrong monitor (three unaligned coordinate spaces) |
| M1 | Medium | Capture selection | `resolveWindowsCaptureDisplay` silently substitutes primary bounds while keeping the stale display id (unplugged monitor case) |
| M2 | Medium | Cursor monitor | start/stop race orphans `cursor-monitor.exe` (50 ms poll loop) for the rest of the app session |
| M3 | Medium | WGC session | No `GraphicsCaptureItem.Closed` handling → monitor unplug mid-recording hangs the helper instead of failing |
| M4 | Medium | Tray routing | R2 fix is sound, but tray-stop dead-ends if the HUD is closed mid-recording; dispatch result is ignored; R2 regression test does not pin `main.ts` wiring |
| M5 | Medium | uiohook-napi | `rebuild:native` can shadow the tested N-API prebuild with a locally built binary; Windows has no repair path, failure degrades silently |
| L1 | Low | GPU switches | Global `ignore-gpu-blocklist` / `enable-unsafe-webgpu` force GPU on blacklisted drivers; `use-angle: d3d11` is redundant-but-harmless |
| L2 | Low | Cursor monitor | Busy/app-starting and custom cursors all reported as `arrow` |
| L3 | Low | Interaction | Double-click distance threshold (0.04) is normalized to the capture region → semantics change per target |
| L4 | Low | Monitor resolver | 10 s cache caches failures too; hot-plug within TTL hands WGC a stale HMONITOR |
| L5 | Low | Build scripts | ~150 duplicated lines; cursor-monitor hardcodes x64 while wgc-capture is arch-aware; manifest verification is warn-only |

---

## H1 — Window-capture cursor telemetry is dead on Windows: the PowerShell bounds bridge never returns bounds

**Where:** `electron/ipc/cursor/bounds.ts:167-217` (script + invocation), consumer `electron/ipc/cursor/telemetry.ts:179-210`.

**Root cause (probe C).** `resolveWindowsWindowBounds` runs:

```
powershell.exe -NoProfile -Command <script> <windowId> <windowTitle>      # bounds.ts:207-209
```

`-Command` does not bind trailing argv entries to the script's `param([string]$windowId, [string]$windowTitle])` (bounds.ts:168). Verified this session: the params stay empty and the extra args execute as separate commands. The script therefore always reaches `if ($handle -le 0) { exit 1 }` (bounds.ts:196-198) → `execFileAsync` rejects → `catch → return null` (bounds.ts:214-216). `resolveWindowsWindowBounds` returns `null` for **every** Windows window, every poll.

**Consequence chain:**

1. `selectedWindowBounds` is always `null` on Windows (only writer of non-null values is the failed resolve; `telemetry.ts:179` gates on it).
2. `getNormalizedCursorPoint()` falls through to the display path (`telemetry.ts:197-210`) and normalizes cursor samples against the **whole display** while the recorded video is only the **window**. For any window that doesn't cover the display, every `cx/cy` in the `.cursor.json` telemetry is wrong — a cursor at the window's top-left is reported at `(windowX / displayW, windowY / displayH)` inside the frame.
3. While a window recording is active, `startWindowBoundsCapture` (bounds.ts:285-304) spawns a fresh `powershell.exe` (with an Add-Type compile) every 1000 ms (`WINDOWS_BOUNDS_POLL_INTERVAL_MS`, bounds.ts:230). Each invocation burns ~0.5-2.5 s of CPU and then fails (`exit 1`); the in-flight guard (bounds.ts:247) prevents overlap but not the churn. This competes with the capture/encode path during every window take.

**Latent follow-on (must be fixed together):** the consumer math (`telemetry.ts:181-193`) divides the returned bounds by the display `scaleFactor`, i.e. it assumes physical-pixel bounds. Per probes A/B, DPI-unaware PowerShell returns coordinates that are already DIP-equivalent (PS `2048×1152` == Electron DIP `2048×1152` on this 125% machine). If the binding bug is fixed naively, the `/sf` division double-scales and window telemetry becomes wrong again, this time by the display scale factor (1.25× here). The fix needs to pick one space end-to-end (either make the PS probe per-monitor-DPI-aware and keep `/sf`, or treat PS output as DIP and drop `/sf`).

**Repro (Windows, any scaling ≠ 100 % or even 100 %):**

1. Record a window (e.g. Notepad at half-screen) with cursor telemetry enabled.
2. Move the cursor to the window's top-left corner; note the position drawn in the editor's cursor overlay / `.cursor.json` samples: it is near `(windowX/displayW, windowY/displayH)` of the frame, not `(0,0)`.
3. During the recording, Task Manager shows `powershell.exe` (+ `csc.exe`) starting every second and exiting with code 1.

---

## H2 — Both native helpers are console-subsystem exes spawned without `windowsHide` → visible console windows on every recording

**Where:** `electron/native/wgc-capture/CMakeLists.txt:7` and `electron/native/cursor-monitor/CMakeLists.txt:7` (plain `add_executable`, no `WIN32`/`WIN32_EXECUTABLE`); spawn sites `electron/ipc/register/recording.ts:556-560` (wgc-capture) and `electron/ipc/cursor/monitor.ts:105-107` (cursor-monitor) — neither sets `windowsHide: true` (Node default `false`).

**Evidence:** Probe D — both shipped `bin/win32-x64/*.exe` binaries are PE subsystem 3 (console). A console-subsystem child spawned by a GUI process without `CREATE_NO_WINDOW`/`STARTF_USESHOWWINDOW(SW_HIDE)` gets a visible `conhost` window. The codebase already knows the pattern: the PowerShell spawns set `windowsHide: true` (`monitorResolver.ts:87`, `bounds.ts:211`) — only the two native-helper spawns miss it.

**Impact:** on every Windows recording, a black console window titled `wgc-capture.exe` appears for the whole take, and `cursor-monitor.exe`'s console stays up for the recording session (the 50 ms poll loop runs until stop). Besides looking broken, the windows can land on the recorded region and appear in the capture (WGC captures the monitor; `IsCursorCaptureEnabled(false)` only excludes the pointer, not windows).

**Repro:** launch packaged MoRec (fresh desktop, no terminal), start any recording → two console windows appear; stop → they disappear.

**Note:** building with `-DWIN32` (GUI subsystem) is not a full alternative fix by itself — stdout stays usable because stdio is piped, but `windowsHide: true` at both spawn sites (or `CREATE_NO_WINDOW`) is the minimal change.

---

## H3 — Mixed-DPI multi-monitor: secondary display capture fails or can silently record the wrong monitor

**Where:** three coordinate spaces joined by exact comparisons:

- `electron/ipc/monitorResolver.ts:20-51` — PowerShell `EnumDisplayMonitors` rects, **DPI-unaware** space (probe A: physical × 96/system-DPI, uniform).
- `electron/ipc/register/recording.ts:479-483` — matches those rects against Electron **DIP** bounds (`resolveWindowsCaptureTarget` → `captureTarget.bounds`) by **origin only**.
- Fallback `recording.ts:489` passes `captureTarget.displayId` — an Electron display id, which is a Chromium hash (probe B: `189667873`), **not an HMONITOR** — so `findMonitorByDisplayId` (`monitor_utils.cpp:31-41`) can never match it.
- `electron/native/wgc-capture/src/monitor_utils.cpp:43-68` — bounds/`MonitorFromRect` matching inside the helper, which runs **system-DPI-aware** (`__COMPAT_LAYER=HighDpiAware`, `recording.ts:553-559`) — a third space (physical on the system-DPI monitor, virtualized elsewhere).

**Analysis (derived from the probes; mixed-DPI hardware not available on this machine — single-monitor):**

- Single monitor or all-monitors-same-scale: spaces coincide (uniform transform / shared origin), the origin match or the in-helper exact/origin/`MonitorFromRect` chain lands correctly. This is why it works on dev machines.
- Secondary monitor with scale ≠ primary scale: DIP origin = physicalOrigin/sf_secondary while PowerShell origin = physicalOrigin/sf_primary → the main-process origin match fails → Electron-id fallback is a guaranteed miss → the helper's exact/origin matches fail too (same reason) → everything rides on `MonitorFromRect(DIP-rect in helper space)`:
  - *Failure variant:* primary 2560×1440 @ 150 % + 1920×1080 @ 100 % secondary (physical origin 3840,0). The helper's virtualized secondary rect starts at x=2560; the DIP rect starts at x=3840 → zero intersection → `MONITOR_DEFAULTTONULL` → `ERROR: Could not find monitor for displayId` (`main.cpp:311-314`) → start fails.
  - *Wrong-content variant:* primary 1920×1080 @ 100 % + 4K @ 200 % secondary. DIP rect x∈[960,2880] intersects the primary and the secondary with near-equal area → `MonitorFromRect` tie-breaking can return the **primary** → the helper captures the wrong monitor with no error. The margin that decides "wrong monitor vs correct vs fail" is monitor size/arrangement-dependent, which is exactly the property you don't want in a selection path.
- The main-process origin-only match (recording.ts:479-483) can also mis-attribute in arrangements where two displays' origins coincide across spaces (e.g. a 3-monitor mixed setup where one display's DIP origin equals another's virtualized origin) — recording monitor B's HMONITOR when monitor A was selected.

**Repro (failure variant, common laptop+dock):** 4K internal @ 150 % + 1080p external @ 100 % → select the external display in the source picker → start recording → "Failed to start native Windows capture", helper stderr shows `Monitor ID match failed, attempting coordinate-based match` then `Could not find monitor for displayId`.

**Suggested direction (not implemented):** make one component authoritative for topology — e.g. have the PowerShell probe report HMONITOR + `MONITORINFOEXW.szDevice` and match Electron's `display.bounds`/`display.id` via `DisplayDevice` mapping, or do the enum inside the helper with per-monitor-v2 awareness and pass the DIP rect with scale factors instead of exact coordinate equality.

---

## M1 — `resolveWindowsCaptureDisplay` silently substitutes primary bounds while keeping the stale display id

**Where:** `electron/ipc/windowsCaptureSelection.ts:68-75`; behavior codified by `electron/ipc/windowsCaptureSelection.test.ts` ("keeps the requested display id even if Electron cannot rematch it, while using primary bounds").

**Problem:** when `display_id` is set but no longer matches any live display (monitor unplugged between selection and record start, or a stale source object), the function returns `displayId: <requested>` with `bounds: primaryDisplay.bounds`. Consumers get a coherent-looking but wrong answer: `displayBounds` diagnostics (`recording.ts:456-457, 539`) attribute the recording to the requested monitor, the fallback chain may capture the primary, and cursor telemetry normalizes against the primary (`telemetry.ts:197-210` — the display-id lookup fails, cursor is mapped via `getDisplayNearestPoint`). No error reaches the user.

**Repro:** select monitor 2 → unplug it (or disable it in Settings) → start recording → recording proceeds against monitor 1 while the UI still shows "Monitor 2".

---

## M2 — cursor-monitor start/stop race orphans the helper process

**Where:** `electron/ipc/cursor/monitor.ts:76-121` (async start: `fs.access` → `spawn` → state set) vs `monitor.ts:54-74` (sync stop reads `nativeCursorMonitorProcess`); toggled from `set-recording-state` (`register/recording.ts:1773` `void startNativeCursorMonitor()`, `:1789` `stopNativeCursorMonitor()`).

**Problem:** `stopNativeCursorMonitor()` is synchronous and only kills a helper whose process handle has already been stored. If stop runs while start is still awaiting `fs.access` (or between spawn and `setNativeCursorMonitorProcess`), stop is a no-op and the helper spawns afterward — a `cursor-monitor.exe` polling `GetCursorInfo` every 50 ms (with its console window, see H2) survives until the app exits or the next recording cycle's start/stop pair reaps it. Its stdin never closes (the parent lives on), so the built-in parent-death stop (`main.cpp:11-20`) never fires.

**Repro:** start and stop a recording in quick succession (or toggle two rapid state changes) → `cursor-monitor.exe` remains in Task Manager after stop; it disappears only after the next record cycle or app quit.

---

## M3 — WGC session ignores capture-item loss mid-recording (no `GraphicsCaptureItem.Closed` handling)

**Where:** `electron/native/wgc-capture/src/wgc_session.cpp:216-231` (`startCapture` never subscribes `captureItem_.Closed`), fatal-error flag set only by frame-pool `Recreate` failure (`wgc_session.cpp:170-175`), helper wait loop `main.cpp:400-411`.

**Problem:** when the captured monitor is unplugged (display capture) the WGC item closes and frames simply stop arriving; `hasFatalError()` never becomes true, so the helper loops on the condition variable at 20 ms indefinitely and reports nothing. The main process keeps the "recording" state and tray icon; the user must stop manually (which still salvages the partial file via `attachWindowsCaptureLifecycle`, `recording/windows.ts:179-231`). Separately, `session_.StartCapture()` (wgc_session.cpp:229) can throw `hresult_error` (e.g. item already closed) — unhandled → helper terminates; surfaced as a generic start failure.

**Repro:** start a display recording on monitor 2 → unplug monitor 2 → recording UI stays "active" with no new frames; no interruption event is emitted until the user stops.

---

## M4 — Tray-stop routing: R2 (mainWindow-null) is fixed, but two residual gaps remain

**Verified sound:** `dispatchStopRecordingFromTray` (`electron/windows.ts:536-572`) targets the registered HUD window first, then scans for `windowType=hud-overlay` URLs, then broadcasts. Wired to the tray at `electron/main.ts:769-773`; the renderer listener chain is complete (`preload.ts:595-599` → `src/hooks/useScreenRecorder.ts:1379-1383`). The mainWindow-null scenario from the recording-lifecycle review (R2) works: with `mainWindow` null/destroyed and the HUD alive, tray stop reaches the HUD. Adversarial suite (`trayRouting.adversarial.test.ts`) covers null/undefined pool entries, packaged `file://` URLs, pre-navigation URLs, and multi-window pools.

**Residual gaps:**

1. **HUD closed mid-recording → unstoppable recording.** `hud-overlay-close` (`main.ts:1025-1041`) closes the HUD without checking whether a native capture is still running. If the HUD goes away while the helper records, `dispatchStopRecordingFromTray` falls to the broadcast (windows.ts:563-569), which sends `stop-recording-from-tray` to the editor window — whose `useScreenRecorder` instance is not recording, so `stopRecording()` no-ops. Dispatch returns `true` (it "sent" something), the tray click does nothing, and the recording continues until the app quits. Repro: start a display recording → close the HUD → tray → Stop Recording → nothing happens.
2. **Dispatch result ignored.** `main.ts:771` calls `dispatchStopRecordingFromTray()` without using the boolean — the all-windows-destroyed path returns `false` with zero user feedback (no toast/notification), which looks like a dead tray menu.
3. **Test-integrity note.** The R2 scenario test (`trayRouting.test.ts:238-269`) re-implements the `mainWindow` lifecycle *inside the test* (local `mainWindow` variable, local null-out) and then asserts `windows.ts` behavior — it never imports or exercises `main.ts`'s actual wiring. A regression that reverted `main.ts:771` back to `mainWindow.webContents.send(...)` would pass this suite. The adversarial suite has the same shape (it tests `windows.ts` only). Fine as unit tests; just don't rely on them as the R2 regression gate.

---

## M5 — uiohook-napi: N-API prebuild is fine; the risk is `rebuild:native` shadowing it, and Windows has no repair path

**Where:** `electron/ipc/cursor/interaction.ts:161-178` (module load), `:98-159` (arch repair, darwin-arm64 only), `package.json:17` (`rebuild:native` → `@electron/rebuild --force --only uiohook-napi`), `electron-builder.json5:10` (`asarUnpack: ["node_modules/uiohook-napi/**"]`).

**Assessment (the requested "rebuild risk"):**

- The packaged path is healthy today: `uiohook-napi@1.5.4` is N-API (ABI-stable, no Electron-ABI rebuild needed), ships `prebuilds/win32-x64/node.napi.node`, and the builder asarUnpacks the whole package. Fresh installs load the tested prebuild.
- **Shadow risk:** the package loads via `node-gyp-build`, which prefers `build/Release/uiohook_napi.node` over `prebuilds/`. Running `npm run rebuild:native` creates exactly that shadow binary. This is the same mechanism that produced the darwin-arm64 "incompatible architecture" repair path (`interaction.ts:98-159`) — evidence the failure mode has bitten before. On Windows there is **no** repair path: a stale/broken `build/Release` binary yields `ERR_DLOPEN_FAILED` at record start, caught by `startInteractionCapture`'s warn-once handler (`interaction.ts:310-315`) → interaction telemetry silently missing for the whole session (clicks/double-clicks gone from the overlay) while video recording continues.
- Since the module is N-API, `rebuild:native` targeting it provides no benefit; the script mostly risks producing a binary that diverges from the prebuild in the packaged app.

**Repro (shadow + silent degradation):** run `npm run rebuild:native` → package → `app.asar.unpacked/node_modules/uiohook-napi/build/Release/uiohook_napi.node` now ships instead of the prebuild; corrupt it (or block its load) on Windows and record → no click markers, single console warning only.

**Environmental note (UIPI):** low-level mouse/keyboard hooks installed by a non-elevated process do not receive input directed at elevated windows on Windows. Clicks inside an app running as administrator are invisible to interaction telemetry. Not fixable in-process; worth a docs/known-issues line.

---

## L1 — GPU switch side effects

**Where:** `electron/main.ts:85-87, 97-123`; `electron/gpuSwitches.ts:54-56`.

- `ignore-gpu-blocklist`, `enable-unsafe-webgpu`, `enable-gpu-rasterization` are appended **globally on all platforms**. On Windows boxes with blacklisted/old GPU drivers this forces GPU compositing where Chromium would have chosen SwiftShader — for a screen-recording app, a renderer crash or artifact on a flaky driver is worse than slower rendering. No user-facing escape hatch exists.
- `use-angle: d3d11` (win32) matches Chromium's current default on Windows, so today it only *pins* the backend — it forecloses the D3D11on12 path used for some HDR/advanced swapchains and silently becomes load-bearing the day the Electron default changes. Harmless now; flag it when bumping Electron majors.
- Ordering is correct: `configureGpuAccelerationSwitches()` runs at module top-level, before app ready (`main.ts:123`). No WGC/encoder interplay — the helper creates its own D3D11 device in a separate process.

## L2 — Cursor type mapping gaps in the native monitor

**Where:** `electron/native/cursor-monitor/src/main.cpp:25-35`.

`IDC_WAIT` and `IDC_APPSTARTING` map to `"arrow"` (busy state is lost from telemetry), and any custom cursor handle (browser CSS cursors, games, design tools) falls back to `"arrow"`. Best-effort by design, but the cursor-type overlay will silently show "arrow" during busy spins on Windows.

## L3 — Double-click threshold is normalized to the capture region

**Where:** `electron/ipc/cursor/interaction.ts:229-241`.

`distance <= 0.04` compares normalized coordinates: on a display capture that's 4 % of the display (~82 px on a 2048-DIP-wide monitor — very lenient, so mouse-jitter double-clicks may be over-detected); once H1 is fixed it becomes 4 % of the *window* (a tiny window makes real double-clicks hard to detect). The threshold's meaning silently changes with the capture target.

## L4 — Monitor-handle cache caches failures and topology changes

**Where:** `electron/ipc/monitorResolver.ts:53-54, 90-96`.

10 s TTL; a PowerShell failure caches an **empty** handle list for 10 s (record-start within that window skips handle resolution entirely and rides the already-fragile coordinate fallback of H3), and a hot-plug within the TTL hands WGC a stale HMONITOR (fails at `CreateForMonitor`). Bounded and self-healing; listed for completeness. The sync `getMonitorHandles()` variant is test-only today.

## L5 — Build scripts: duplication, arch inconsistency, warn-only manifest gate

**Where:** `scripts/build-windows-capture.mjs`, `scripts/build-cursor-monitor.mjs`.

- ~150 lines of identical `findCmake` / configure / build / stage logic — one divergence already exists: `build-windows-capture.mjs:23-27` is arch-aware (stages `win32-arm64`, `-A ARM64`) while `build-cursor-monitor.mjs:128` hardcodes `-A x64` — on an ARM64 host the two helpers end up in different architectures/dirs.
- When CMake is absent, both scripts verify the bundled helper but only **warn** on manifest mismatch and `exit 0` (`build-windows-capture.mjs:95-108`, `build-cursor-monitor.mjs:91-105`) — a stale/foreign binary ships with a console warning.
- Nit: `isNativeWindowsCaptureAvailable` uses `X_OK` on Windows (`recording/windows.ts:64`), which the codebase itself calls out as meaningless on Windows in `cursor/monitor.ts:89-90` (works because libuv maps X_OK→F_OK, but the inconsistency invites copy-paste).

---

## Verified-OK areas (so the absence of findings is explicit)

- **R2 core (tray stop with mainWindow null/destroyed):** primary-path dispatch + URL scan + broadcast fallback are wired correctly end-to-end (see M4 for residual edges only).
- **HUD overlay bounds math:** `hudOverlayBounds.ts` clamps correctly; fallback (Win10 < 22000, `windows.ts:135-146`) sizes/centers within the work area; `display-removed` / `display-metrics-changed` re-clamp the overlay (`windows.ts:497-511`); passthrough corruption re-assert toggles (`windows.ts:455-466, 584-606`) are defensive and bounded by timers.
- **WGC encoder resize path:** frame-size changes are composited into a fixed surface (`mf_encoder.cpp:148-222`) — window resizes mid-recording do not corrupt the MP4; pause/resume timestamp adjustment is QPC-consistent with audio sidecar metadata (`main.cpp:159-198, 200-245`).
- **Helper orphan protection:** stdin-close triggers stop in both helpers (`wgc-capture main.cpp:272-274`, `cursor-monitor main.cpp:11-20`), and `before-quit` finalizes an active take with a bounded 5 s wait (`main.ts:902-934`).
- **GPU switch application order** (pre-ready) and the win32 `d3d11` choice itself.
- **Cursor telemetry clock:** pause/resume accumulation and boundary trimming (`telemetry.ts:101-165`) are consistent; drift-compensated 33 ms scheduler (`telemetry.ts:306-335`) is sound.
- **uiohook-napi packaging:** prebuild present for win32-x64, N-API, asarUnpacked, mouse-button normalization (incl. legacy 38/39 codes) handled (`interaction.ts:30-44`).

*Findings only — nothing here is implemented. Fixes await approval.*
