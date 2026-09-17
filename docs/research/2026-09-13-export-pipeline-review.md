> **Status (2026-09-17):** Resolved. The five High findings were fixed in PR #24. Consolidated to main with review PR #5; this file is the record copy.

# Export pipeline review — Windows, 2026-09-13

Review only — no code changes proposed or made. Findings are ordered by severity; every
finding cites `file:line` and, where useful, a minimal failing input. Line numbers refer to
`main` at commit `e6e7aee`.

**Scope as requested**

- `electron/ipc/export/` (`native-video.ts`, `exportStream.ts`, `nativeStaticLayoutRoutePlan.ts`)
- `electron/ipc/ffmpeg/` (`binary.ts`, `filters.ts`)
- `electron/ipc/nativeVideoExport.ts`
- `src/lib/exporter/` (all non-test files)
- `scripts/build-windows-gpu-export.mjs`, `scripts/build-nvidia-cuda-compositor.mjs`,
  `scripts/benchmark-export-queues.mjs`
- The renderer-side wiring that feeds these paths and receives progress/cancel/error:
  `src/lib/exporter/modernVideoExporter.ts`, `src/components/video-editor/ExportSettingsMenu.tsx`,
  `exportDimensions.ts`, `mp4ExportRouting.ts`, `exportStatusModel.ts`, `backendPolicy.ts`,
  `editedTrackStrategy.ts`, and the `electron/ipc/register/export.ts` handlers.

**How route selection actually works (context for the findings)**

For a regular "Lightning" (modern-pipeline) MP4 export, `mp4ExportRouting.ts:32-45` forces
`backendPreference = "auto"`. With `auto`, `backendPolicy.ts:46` keeps the static-layout-first
probe disabled, so `modernVideoExporter.ts:394-401` does **not** try the native static-layout
compositor; the default path is the Breeze streaming encoder (browser H.264 → ffmpeg stdin,
`inputMode: "h264-stream"`). The native static-layout compositor (`exportNativeStaticLayoutVideo`)
is entered only when (a) the user enables the experimental NVIDIA CUDA toggle
(`experimentalNvidiaCudaExport === true`, which also defers the Breeze start so static layout is
tried first), or (b) a smoke-export run selects `breeze`. When the static-layout run fails, the
renderer silently falls back to a full WebCodecs/Breeze re-render
(`modernVideoExporter.ts:2521-2576`).

## Findings

### HIGH

#### H1 — Offline audio render accumulates the entire decoded/rendered PCM in the renderer heap (OOM on long or heavily edited exports)

- `src/lib/exporter/audioEncoder.ts:1125` — `streamDecodeFromUrl` pushes **every** decoded
  Float32 chunk into `channelChunks` and then copies it all into a second full-size
  `AudioBuffer` (lines 1240-1252). The comment at lines 1103-1104 claims streaming avoids
  loading "the entire compressed file" — true for compressed bytes, but decoded PCM memory
  scales linearly with duration (48 kHz stereo ≈ 384 KB/s ≈ 1.4 GB/hour, ×2 for the final
  copy).
- `src/lib/exporter/audioEncoder.ts:912-925` — `renderToWavBlobChunked` likewise collects all
  rendered PCM into `pcmParts` (despite its own comment "Processes in chunks to avoid holding
  the entire output in memory"), then `new Blob(pcmParts)` copies it again. Consumers add more
  full copies: `modernVideoExporter.ts:1977` (`await audioBlob.arrayBuffer()`), structured
  clone over IPC, and `electron/ipc/export/native-video.ts:4122`
  (`Buffer.from(options.editedAudioData)`).
- This path runs for every export with speed regions, audio regions, non-default track
  settings, or undecodable source audio (`offline-render-fallback` audio plan,
  `modernVideoExporter.ts:1336-1376`).

Minimal failing input: a 2-hour 48 kHz stereo recording plus a single 0.25× speed region →
multi-GB transient allocations in the renderer → OOM / export crash.

Related (same root, lower severity): `audioEncoder.ts:1299-1314` (`bulkDecodeFromUrl`) does
`response.arrayBuffer()` on the **whole media file** when streaming decode fails — a 4 GB MKV
with AC-3 audio plus any speed edit OOMs before reporting "audio codec unsupported".

#### H2 — The FFmpeg static-layout route hard-requires NVIDIA CUDA, contradicting the route plan that names it as the no-GPU fallback; on non-NVIDIA machines it burns a full-length CPU proxy encode before failing

- `electron/ipc/export/nativeVideoExport.ts:324-338` (`buildNativeCudaOverlayStaticLayoutArgs`),
  `:355-369` (`buildNativeCudaScaleCpuPadStaticLayoutArgs`), `:488-531`
  (`buildNativePrecompositedStaticLayoutArgs`) all hardcode `-hwaccel cuda
  -hwaccel_output_format cuda` **and** `-c:v h264_nvenc`. There is no libx264/CPU variant of
  the static-layout compositor anywhere (contrast `resolveNativeVideoEncoder`,
  `electron/ipc/export/native-video.ts:3967-3995`, which properly probes encoders for the
  Breeze path).
- The OOM chunked fallback re-uses the same two CUDA builders
  (`electron/ipc/export/native-video.ts:3718-3777`), so all three "fallback tiers" fail
  identically on machines without a working NVENC.
- Meanwhile `electron/ipc/export/nativeStaticLayoutRoutePlan.ts:120-124` documents
  `ffmpeg-static-layout` as the selected route with reason
  `"native-gpu-routes-unavailable"` — i.e. the plan asserts a no-GPU fallback that the argument
  builders do not implement (see also M9: this planner is dead code).
- Cost amplification: before any backend is attempted, `exportNativeStaticLayoutVideo`
  unconditionally runs `prepareNativeStaticLayoutSourceInput`
  (`electron/ipc/export/native-video.ts:3261` → `:2601-2646`). For non-H.264 sources
  (e.g. VP9/WebM recordings) this re-encodes the **entire recording** to an H.264 proxy with
  libx264 at up to 80 Mbps (`nativeVideoExport.ts:1114-1178`, timeout
  `durationSec × 2000`), even when every downstream compositor attempt will fail.

Minimal failing input: Windows machine with Intel/AMD-only graphics where the GPU probe is
unavailable (treated optimistically as "has NVIDIA", `native-video.ts:1872-1875
hasNvidiaGpu ?? true`) with the CUDA toggle enabled — or a smoke run with
`smokeUseNativeExport=1&smokeBackendPreference=breeze` — on a VP9/WebM recording: full-length
proxy encode, then 4+ failed ffmpeg spawns (`Unknown encoder 'h264_nvenc'` / `Failed setup for
format cuda`), then a complete WebCodecs re-render. The renderer fallback keeps the feature
working, so this presents as mysterious multi-minute stalls rather than an error.

#### H3 — Unsupported source audio silently produces a "successful" export with an empty/broken audio track

- `src/lib/exporter/audioEncoder.ts:424-428` — when `AudioDecoder.isConfigSupported` rejects the
  source codec (e.g. AC-3 in an MKV), `AudioProcessor.process` logs a `console.warn` and
  **returns**; the same silent-return pattern exists for unsupported sample-rate/channel AAC
  configs (lines 535-539) and for the offline encoder (lines 857-861).
- The muxer was already built with an audio track (`modernVideoExporter.ts:652-657`, hasAudio
  follows the audio plan, not actual decoded data), and mediabunny writes an empty `stbl`
  without erroring on finalize — the export completes with success and no usable audio.
- The global guard `shouldUseFfmpegAudioFallback` (`modernVideoExporter.ts:532-535`) only
  covers the 48 kHz/2-channel default config, not per-source configs.

Minimal failing input: an MKV/MP4 recording whose audio codec the renderer cannot decode →
MP4 export reports success; the file has a video stream and an empty audio track.

#### H4 — Lightning (modern renderer) rasterizes annotations against the full canvas instead of the content rect

- `src/lib/exporter/modernFrameRenderer.ts:1602-1607` — the sprite rasterization path uses
  `this.layoutCache?.maskRect ?? { x: 0, y: 0, width: this.config.width, height: this.config.height }`,
  but `layoutCache` is only populated by `updateLayout()`, which first runs inside
  `renderFrame()` (`:3194-3196`) — after `initialize()` has already called
  `setupAnnotationLayer()` (`:633-635`). So the fallback (full canvas) geometry is always the
  one baked into the sprites; `updateAnnotationLayer()` (`:1637-1643`) later only toggles
  sprite visibility and never corrects geometry.
- Annotation positions/sizes are maskRect-relative by convention
  (`annotationRenderer.ts:374-387`); the legacy renderer feeds the correct rect per frame
  (`frameRenderer.ts:1711-1725`), so this is a Lightning-only divergence.

Minimal failing input: export 1920×1080 from a 1366×768 source (letterboxed; maskRect ≈
`{0, 207, 1920, 666}`) with any annotation → sprite placed/sized against 1920×1080;
e.g. a 50%-size annotation rasterizes at 540 px tall instead of 333 px, and any off-center
annotation lands in the wrong place.

#### H5 — Cursor-follow zoom uses raw source coordinates in the renderers/preview but crop-projected coordinates in the static-layout path: camera aims at different content under a non-default crop

- `computeZoomTransform` interprets `focusX/focusY` as normalized within `baseMask` — the
  cropped content rect (`zoomTransform.ts:410-411`).
- The static-layout sampler feeds it **crop-viewport-projected** cursor telemetry
  (`modernVideoExporter.ts:2159-2169` → `nativeStaticLayoutTelemetry.ts:146`
  `projectCursorPositionToViewport`) — correct space.
- The renderer exports and the preview feed **raw** source-normalized telemetry straight into
  `computeCursorFollowFocus` (`modernFrameRenderer.ts:3730-3738`, `frameRenderer.ts:1981-1989`,
  `VideoPlayback.tsx:2428-2434`); nothing inside `computeCursorFollowFocus`/
  `interpolateCursorPosition` projects (`cursorFollowCamera.ts`). `cursorViewport.ts` exists
  precisely to do this projection and is bypassed on these paths.

Minimal failing input: `cropRegion {x:0.5, y:0, width:0.5, height:1}`, cursor at source
`cx=0.6` → preview/renderer exports aim the camera at content `0.6` (source ≈ `0.8`) while the
cursor is displayed at content `(0.6−0.5)/0.5 = 0.2`; the static-layout export correctly aims
at `0.2`. Visible divergence between preview, Lightning and static-layout outputs; with the
default crop both spaces coincide, which is why it goes unnoticed.

### MEDIUM

#### M1 — No progress events on any FFmpeg static-layout route: UI sits at "Preparing export… 0%" for the whole render

`onProgress` is only invoked from the two GPU-compositor wrappers
(`native-video.ts:2934`, `:3114`) and the audio-mux finalizing block
(`native-video.ts:3816-3837`). The precomposited run (`:3648-3673`), the cuda-overlay /
cuda-scale-cpu-pad full runs (`:3675-3698`), the chunked OOM fallback (`:3718-3795`), and the
source-proxy/background renders never emit progress. The renderer seeds the bar at
`reportProgress(0, totalFrames, "preparing")` (`modernVideoExporter.ts:2385`) and nothing moves
until audio mux maps 97.25→99. This is the same symptom that motivated disabling the
auto static-layout probe (`backendPolicy.ts:44-46` comment). Reachable for CUDA-opt-in users
whenever the D3D11 helper is missing/failed and the FFmpeg CUDA path runs (including the OOM
chunked path), and for all smoke-breeze static-layout runs.

#### M2 — Cancel is surfaced to the user as an export failure

- `VideoEditor.tsx:5390-5401` (`handleCancelExport`) calls `exporter.cancel()`, toasts
  "Export canceled", and resets the UI. But the awaited `exporter.export()` then settles with
  `{success:false, error:"Export cancelled"}` (`modernVideoExporter.ts:2564-2570` for static
  layout; `:907-912` for the streaming path), and the continuation at
  `VideoEditor.tsx:5092-5094` overwrites the reset with `setExportError(...)` plus an error
  toast and `keepExportDialogOpen = true` — the user who cancelled sees an "Export failed"-style
  error panel.
- Main-side, the plain FFmpeg paths have no cancellation marker at all:
  `runFfmpegWithMetrics` (`native-video.ts:1220-1274`) resolves a killed process as a generic
  non-zero exit ("FFmpeg exited with code 1"), unlike the compositor wrappers which check
  `session.terminating` (`native-video.ts:2965-2967`, `:3145-3147`). A cancel during the
  precomposited/chunked render therefore surfaces as an ffmpeg failure string.

Minimal failing input: start any Lightning export, press Cancel during the render.

#### M3 — Flat 15-minute hard kill on full-length FFmpeg static-layout renders and the audio mux

`native-video.ts:3655` (precomposited), `:3678`/`:3693` (cuda-overlay and scale-cpu-pad full
runs), and `:4150` (audio mux) pass a fixed `15 * 60 * 1000` timeout regardless of duration.
The GPU-compositor wrappers scale with duration instead (`:3040`
`Math.max(15*60*1000, durationSec*1000)`, `:2819` `durationSec*2000`), so the codebase's own
policy acknowledges unbounded render times; the FFmpeg full-length paths do not. On a weak
NVIDIA GPU (e.g. MX-series at <1× realtime for 4K), a >~7-minute recording is SIGKILL'd
mid-render after minutes of work. (Chunked runs are safe: each chunk ≤ 300 s gets its own
15-minute budget, `:3743`/`:3757`.)

#### M4 — Finalization watchdog can kill a healthy export during long silent audio phases

`src/lib/exporter/finalizationTimeout.ts:13-15,48-67` — the idle window is 90 s–5 min, and
`advanceFinalizationProgress` (`:96-98`) only counts strictly increasing progress. During
`prepareOfflineRender`, progress is reported exactly twice — 0 at start
(`audioEncoder.ts:709`) and 0.2 after **all** decoding completes (`:778`) — because decoding
itself is not instrumented. A 1–2 hour edited recording whose decode takes >5 min is killed
with "Export timed out … without observable progress" while nothing is wrong. (The decode cost
itself is H1.)

#### M5 — No try/finally around the streaming decode loop: on error, the background feed keeps decoding and GPU-backed VideoFrames leak

`src/lib/exporter/streamingDecoder.ts:544-556` — cleanup (`reader.cancel()`, `await
feedPromise`, closing `pendingFrames`, `decoder.close()`) is not in a `finally`. If `onFrame`
throws (renderer/encoder failure — it is awaited at `:399` and `:494`) or the drain loop
rethrows `decodeError` (`:539`), the unawaited `feedPromise` (`:326-375`) continues demuxing +
decoding the rest of the file, and the local `heldFrame` (a GPU-backed `VideoFrame`) is never
closed. Exporter `cleanup()` cannot reach `heldFrame`. Symptom: after a mid-export error, CPU/
GPU burn and memory growth continue until GC/process teardown.

#### M6 — Container-duration trust: overstated duration hard-fails at 100%; understated duration silently truncates

`src/lib/exporter/streamingDecoder.ts:558-568` — the early-end check compares against
`expectedOutputFrames` derived from container metadata (`:208-222`). A WebM whose declared
duration overshoots the decodable clusters by >1 s (common after pauses/gappy timestamps)
fails the entire export after fully decoding ("Video decode ended early"); a ≤1 s shortfall
silently produces a video shorter than the audio, while `-t`/`apad` use the same overstated
`effectiveDurationSec`. Related: the audio demuxer read never passes `readEndSec`
(`audioEncoder.ts:430-433` receives `undefined` from both exporters at
`modernVideoExporter.ts:825` / `videoExporter.ts:411`), although the video decoder deliberately
passes an explicit range for exactly this container hazard (`streamingDecoder.ts:316-323`).

#### M7 — Two divergent mic-track classifiers; embedded system audio can be silently dropped from the export

`audioEncoder.ts:75-103` classifies sidecar paths by matching `.mic.`, `-mic.`, `_mic_`,
`mic.mp4`/`mic.m4a` suffixes; `audioRoutingEngine.ts:32-37` (used by
`resolveSourceTrackRoutingPolicy` / `buildResolvedAudioPlan`) only matches the `.mic.` /
`.system.` substrings. With `includeEmbeddedInExport = !pathsByTrack.system &&
!pathsByTrack.mixed` (`audioRoutingEngine.ts:71`), a sidecar named `session-mic.m4a` counts as
`mixed` for routing (embedded audio excluded) but as `mic` for gain processing.

Minimal failing input: recording with embedded system audio + sidecar `recording-mic.m4a`,
export with any edit that takes the offline audio path → output contains mic audio only.

#### M8 — Pure-WebCodecs exports ship a moov-at-end MP4 while every other path uses +faststart

`src/lib/exporter/muxer.ts:126-129` creates `Mp4OutputFormat({ fastStart: false })`. All
ffmpeg-assisted finishes add `-movflags +faststart` (`nativeVideoExport.ts:312,342,558,723`;
`native-video.ts:4085`), but when no audio muxing happens the stream result is returned as the
final file directly (`modernVideoExporter.ts:881-887`) — no remux. Video-only WebCodecs exports
get a progressively-unfriendly MP4 inconsistent with the rest of the pipeline.

#### M9 — The documented route plan is dead code; a large part of `filters.ts` is dead code with no production caller

- `planNativeStaticLayoutRoutes` (`electron/ipc/export/nativeStaticLayoutRoutePlan.ts:54-132`)
  has zero callers (grep: own file + test only). Actual routing is the renderer skip-reason list
  (`modernVideoExporter.ts:1508-1605`) plus the try-chain in `exportNativeStaticLayoutVideo`
  (`native-video.ts:3321-3674`). The plan's claims (notably the no-GPU FFmpeg fallback, H2) are
  not enforced anywhere.
- In `electron/ipc/ffmpeg/filters.ts`, `getAudioSyncAdjustment` (`:31-69`),
  `applyRecordedAudioStartDelay` (`:71-99`), `appendSyncedAudioFilter` (`:101-141`),
  `normalizePauseSegments` (`:147-188`), and `buildPausedAudioFilter` (`:190-242`) have no
  production callers (tests only); only `buildAtempoFilters`/`ATEMPO_FILTER_EPSILON` are live
  (imported by `nativeVideoExport.ts:6`). `parseFfmpegDurationSeconds` is duplicated at
  `native-video.ts:940-952`, and `formatFfmpegSeconds` exists three times
  (`filters.ts:143`, `nativeVideoExport.ts:592`, `native-video.ts:42`).
  Implication worth stating: recorded-audio start-delay and pause-aware audio filters are
  **not** wired into the native mux path; that behavior exists only in the AudioProcessor
  offline render.

#### M10 — 0.25× speed (a first-class UI option) always takes the expensive offline audio path

`src/lib/exporter/editedTrackStrategy.ts:3-4,23-27` clamps the filtergraph fast path to
0.5–2.0, while the UI offers 0.25× (`types.ts:589-605`), the WebCodecs video path honors raw
speed (`streamingDecoder.ts:645`), and the static-layout video timeline allows 0.25–30
(`modernVideoExporter.ts:201-218`). The main-process filter builder already supports arbitrary
ratios by chaining (`filters.ts:6-29` `buildAtempoFilters`). Every 0.25× export therefore
renders the whole output timeline through the JS offline audio renderer — the exact path that
triggers H1 memory and M4 watchdog exposure — for something the fast path could handle.

#### M11 — Static-layout zoom sampler omits spring tuning and transition durations: zoom motion diverges from preview/renderer whenever those settings are non-default

- `modernVideoExporter.ts:2135` — `getZoomSpringConfig(this.config.zoomSmoothness)` without
  the camera spring multipliers that the renderer passes (`modernFrameRenderer.ts:3771-3775`,
  `frameRenderer.ts:2023-2027`, `VideoPlayback.tsx:2474-2478`).
- `modernVideoExporter.ts:2145-2147` — `findDominantRegion(zoomRegions, timeMs,
  { connectZooms })` without `zoomInDurationMs`/`zoomOutDurationMs`, which the renderer
  (`modernFrameRenderer.ts:3708-3712`) and preview pass.

Minimal failing input: `cameraSpringDampingMultiplier = 2` + one zoom region → the
static-layout export eases at default damping while the preview eases noticeably slower.

#### M12 — Hiding the cursor silently disables cursor-follow zoom, static-layout only

`modernVideoExporter.ts:2079-2082` gates the telemetry array on `showCursor === true`, and the
same array is the cursor-follow input (`:2159`). The renderers gate follow purely on telemetry
presence (`modernFrameRenderer.ts:3726-3728`). With `showCursor=false` + recorded telemetry +
an "auto" zoom region, preview/renderer exports track the cursor; the static-layout export
pins the camera at the region's static focus.

#### M13 — Static-layout webcam overlay ignores `reactToZoom`

`modernVideoExporter.ts:2036-2044` builds the overlay once with `zoomScale: 1`, while the
renderers size the webcam per frame with the applied zoom scale
(`modernFrameRenderer.ts:2922`, `frameRenderer.ts:2457`); `getWebcamOverlaySizePx`
multiplies by the zoom scale when `reactToZoom` is on (the default). A 2× zoom grows the
webcam in preview/renderer exports but not in static-layout exports.

#### M14 — Legacy renderer: a webcam decode error aborts the whole export instead of degrading the overlay

`frameRenderer.ts:1264-1267` awaits `webcamForwardFrameSource.getFrameAtTime(...)` with no
try/catch; `ForwardFrameSource.getFrameAtTime` throws on decoder errors
(`forwardFrameSource.ts:122-130,197-199`) and monotonicity violations (`:254-256`). The
sibling background path (`frameRenderer.ts:803-816`) and the modern webcam path
(`modernFrameRenderer.ts:2673-2696`) both catch and fall back — one corrupt webcam packet in a
legacy export fails the export.

#### M15 — Sample aspect ratio is ignored end-to-end: anamorphic sources export distorted

`streamingDecoder.ts:173-174` and `forwardFrameSource.ts:86-87` carry only coded
width/height; no pipeline stage references SAR (the lone `setsar=1` is on the ffmpeg
background chain, `nativeVideoExport.ts:414`). All layout math
(`computePaddedLayout` at `frameRenderer.ts:1901-1909`, `modernFrameRenderer.ts:3542-3550`,
`modernVideoExporter.ts:2280-2287`; `getNativeStaticLayoutSourceCrop` at
`modernVideoExporter.ts:1430-1443`) bakes coded dims as square pixels.

Minimal failing input: a 1440×1080 source with SAR 4:3 (displays as 1920×1080) → content laid
out and scaled as square-pixel 1440×1080 → squeezed output.

### LOW

- **L1 — Trim-edge A/V drift (WebCodecs path).** `audioEncoder.ts:447,604-605,1839-1851`:
  trim skip/count operate on whole AAC chunk starts (~21 ms granularity), so non-aligned trims
  leave per-trim sub-frame drift vs the frame-accurate video path.
- **L2 — Companion start-delay inference reference.** `audioEncoder.ts:747-749` uses the
  embedded audio duration (not the video duration) as the timeline reference for
  delay inference; only matters when `sourceAudioFallbackStartDelayMsByPath` is absent.
- **L3 — Zero/unknown duration exports silently produce an empty video.**
  `streamingDecoder.ts:653` filters zero-length segments and the main loop never runs; nothing
  errors (`:558-568` cannot trigger with 0 expected frames).
- **L4 — `videoDecoder.ts:22-28` hardcodes `frameRate: 60` / `codec: "avc1.640033"`** in
  `getInfo()`; currently uncalled in live code, but a trap for future callers.
- **L5 — Fallback media source buffers whole remote files.** `localMediaSource.ts:119-129`
  (`await response.blob()`) on the retry path (`streamingDecoder.ts:129-149`); a remote
  multi-GB source OOMs on retry.
- **L6 — Muxer finalize-failure temp leak.** `muxer.ts:163-192`: if `output.finalize()`
  throws, the IPC export stream is closed only via the unawaited `abortStream()` in
  `destroy()`; a fast app exit can persist a multi-GB temp until quit-time reaping.
- **L7 — Timeout races do not cancel the loser.** `finalizationTimeout.ts:144-171` is a pure
  `Promise.race`; in particular `muxExportedVideoAudioFromPath` has no cancel handle, so after
  the user sees a timeout error the main-process ffmpeg keeps muxing to completion
  (`native-video.ts:4150`) and writes a large `-final.mp4` nobody consumes.
- **L8 — Export-stream sessions leak on renderer crash.** `exportStream.ts:18,194-217`:
  sessions persist in the map (file handle + temp file) until app quit
  (`electron/main.ts:924-933`); a renderer crash mid-export leaks the handle/file for the app
  session. `writeToExportStream` also trusts renderer-supplied `position` and double-counts
  `bytesWritten` on overlaps (`:113-115`) — benign because `closeExportStream` returns
  `highestWatermark` (`:171-174`).
- **L9 — Cancel/finish race on the Breeze path.** `register/export.ts:798-832`: cancel after
  `native-video-export-finish` began the audio mux cannot stop it (the mux is invoked without a
  session, `native-video.ts:4090-4150`); cancel reports success while encoding continues.
- **L10 — `scale_cuda` passthrough default.** `nativeVideoExport.ts:331` omits
  `passthrough` in `buildNativeCudaOverlayStaticLayoutArgs`; the option defaults to **true**
  (verified in FFmpeg n6.1.1 source), so when source dims already equal content dims the
  requested `format=nv12` conversion is skipped too. In practice nvdec outputs nv12 for the
  8-bit H.264 this pipeline feeds it, so the overlay formats still match; the
  scale-cpu-pad fallback explicitly sets `passthrough=0` and would self-heal anyway.
- **L11 — Telemetry mislabels.** `register/export.ts:461-468` reports
  `"chunked-h264-nvenc"` / `"static-layout-h264-nvenc"` for any non-GPU-compositor backend
  (including `cuda-overlay`-family runs), and `modernVideoExporter.ts:2735` hardcodes
  `keyFrame: frameIndex % 300 === 0` regardless of fps.
- **L12 — Legacy in-memory save paths still accept up to 2 GiB ArrayBuffers over IPC**
  (`register/export.ts:66-74,731,878,939`). The modern pipeline avoids this via temp paths, so
  this only threatens legacy/blob flows.
- **L13 — Dormant rawvideo capture path is internally inconsistent.**
  `nativeFrameCapture.ts:85-98` (VideoFrame.copyTo, no scaling) vs `:46-58` (readback,
  `drawImage` scaling) disagree when `targetWidth/Height` ≠ canvas dims. Currently
  unreachable — both exporters use `inputMode: "h264-stream"` and the rawvideo capture
  functions have no production callers — and the native side would reject wrong frame sizes
  loudly (`native-video.ts:1578-1586`). A trap if the RGBA path is revived.
- **L14 — Device-frame inset math has no guard against insets summing ≥ 1.**
  `frameRenderer.ts:2313-2318`, `modernFrameRenderer.ts:3618-3625`:
  `screenWidth / (1 - left - right)` divides by zero/negatives on malformed extension data →
  `Infinity` geometry.
- **L15 — Video-wallpaper failure freezes the last frame silently**
  (`frameRenderer.ts:807-815`, `modernFrameRenderer.ts:1872-1880`): when both the decoder and
  the media-element fallback fail, nothing is drawn for the rest of the export — warn-logged
  only.
- **L16 — Extension-hook cursor sampling differs between pipelines**: nearest-sample in
  legacy (`frameRenderer.ts:1830-1840`) vs interpolated in modern
  (`modernFrameRenderer.ts:3456-3475`).
- **L17 — Shadow silhouette divergence**: legacy shadows include the cursor silhouette
  (`frameRenderer.ts:2262`, matching the preview), modern/native build shadows from the
  squircle mask only (`modernFrameRenderer.ts:3672-3697`). Which is correct is a product call.

## Verified working (checked, no findings)

- **FFmpeg argument construction** — the live filter graphs were validated against a real
  binary: the full shadow-layer background graph from
  `buildNativeStaticBackgroundRenderArgs` (lut/pad/gblur/alphamerge/overlay, including
  negative overlay offsets), `pad` on nv12, `overlay=format=auto`, `alphamerge`
  (rgba+gray), and the mux chains `adelay→apad→aresample→asetpts`, `atrim→concat→apad→atrim`,
  and chained `atempo` all parse and produce correct durations on FFmpeg 8.1.2. The bundled
  binary is **FFmpeg 6.1.1** (ffmpeg-static 5.3.0, release tag `b6.1.1`);
  `scale_cuda.passthrough` and `overlay.format=auto` were confirmed present in the n6.1.1
  sources. No filter-graph errors found.
- **Encoder resolution for the Breeze path** — `resolveNativeVideoEncoder`
  (`native-video.ts:3967-3995`) probes encoders with a real 64×64 encode and falls back
  correctly; packaged builds correctly refuse the PATH-based binary
  (`electron/ipc/ffmpeg/binary.ts:119-148`).
- **GPU capability gating** — the CUDA toggle is gated on `getNativeExportCapabilities`
  (`useNvidiaCudaExportOptIn.ts`), persisted opt-in is re-validated on load, and the
  compositor wrappers carry stall guards + summary validation
  (`validateNvidiaCudaExportSummary` / `validateWindowsGpuExportSummary`) with a real
  ffprobe frame/duration check before results are accepted.
- **Large-file plumbing (video path)** — finished exports are handed back as **temp paths**,
  never renderer ArrayBuffers (`native-video.ts:4190-4197`,
  `register/export.ts:671-679`); export-stream writes use Node file positions (double
  precision, safe past 2 GiB); mediabunny emits `co64`/large boxes past 4 GiB. The renderer
  `_finalize` flow (`finalize-exported-video`) moves files without a full read.
- **Audio mux correctness** — `copy-source`/`trim-source`/`edited-track` (filtergraph and
  offline) argument construction produces correct durations; codec-copy decisions
  (`canCopyAudioCodecIntoMp4`) and the `-shortest`/`-t` policy are sound for the plans the
  renderer actually produces (`outputDurationSec` is always set by
  `modernVideoExporter.ts:2509,2795,2884`).
- **Route-plan hygiene elsewhere** — `exportBitrate.ts` (floor 2 Mbps, sane 4K60 values),
  `exportTuning.ts`, `mp4Support.ts`, `exportSavePolicy.ts`, `mediaResource.ts`,
  `sourceAudioFallback.ts` (case-insensitive Windows normalization), and the static-layout
  source-crop math (`modernVideoExporter.ts:1428-1453`, even-aligned, clamped) checked clean.
- **Dimension/aspect math on the main paths is otherwise sound** —
  `roundNativeStaticLayoutContentSize`/`computePaddedLayout` cannot produce content larger
  than the canvas or negative offsets (`nativeStaticLayoutGeometry.ts:23-61`); crop rects are
  even-aligned and clamped (`modernVideoExporter.ts:1430-1463`); the static-layout path's
  padding/shadow/blur conventions match the renderer (same `VIDEO_SHADOW_LAYER_PROFILES`
  module, same `backgroundBlur × 3` scaling). The SAR gap (M15) is the one aspect-class bug
  found. The rawvideo/`-vf vflip` orientation question is moot in practice: no current writer
  feeds the rawvideo pipe (all sessions are `h264-stream`).
- **Frame/decode ordering** — `ForwardFrameSource` midpoint handoff holds (not drops) frames
  at pauses, is VFR-safe, and looping-wallpaper wraps restart before the monotonicity check
  (`forwardFrameSource.ts:295-301`); temporal motion blur's backward-sampling hazard is
  unreachable (both renderers hard-gate it behind `TEMPORAL_ZOOM_MOTION_BLUR_ENABLED =
  false`).
- **Build scripts** — `build-windows-gpu-export.mjs` / `build-nvidia-cuda-compositor.mjs` are
  idempotent, verify a staged-helper manifest before falling back, and the NVIDIA SDK patching
  (`build-nvidia-cuda-compositor.mjs:132-218`) is guarded by content checks and degrades
  gracefully. `benchmark-export-queues.mjs` is a dev harness with correct timeout/cleanup
  handling. Packaging (`electron-builder.json5:7-12,20-27`) stages `electron/native/**`
  unpacked while excluding build dirs, matching the resolver paths in
  `native-video.ts:1902-1958,2102-2158`.

## Method notes

- All scoped files were read in full; claims above were checked against the cross-layer code
  that would guard them (renderer skip reasons, main-process validation, downstream mux
  policy). Two full-file sweeps covered the remaining `src/lib/exporter` bulk (frame
  renderers/telemetry; audio/mux/decoders/policies); every High finding (H1–H5) was re-verified
  directly at the cited lines, and the sweeping agents' "cleared" conclusions (geometry,
  crop alignment, VFR handling, bitrate floors, faststart/stream-size limits) are folded into
  the verified section.
- The `electron/native/gpu-export-probe` / `nvidia-cuda-compositor` C++ helper sources are
  outside the requested scope; findings here cover only the TS-side contracts with them
  (argument construction, summary parsing/validation, fallback order).
- FFmpeg validation commands were run in `.tmp/export-review/` (left in place for reference;
  not committed).
