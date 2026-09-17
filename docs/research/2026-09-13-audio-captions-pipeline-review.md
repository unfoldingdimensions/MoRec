> **Status (2026-09-17):** Resolved. All findings fixed in PR #16 (M1–M4, minors, LOWs), with the format follow-up in PR #21. Consolidated to main from review PR #3 before closing it; this file is the record copy.

# Audio / Captions Pipeline Review — Windows

- **Date:** 2026-09-13 · **Reviewed at:** `e6e7aee` (main)
- **Scope:** `electron/ipc/recording/` (audioFilters, diagnostics, ffmpeg, macCompanionAudio; Windows equivalents `storeMicrophoneSidecar` in `electron/ipc/register/recording.ts` and `muxNativeWindowsVideoWithAudio` in `electron/ipc/recording/windows.ts`), `electron/ipc/captions/` (whisper, parser, segment, silence, generate), `src/components/video-editor/audio/`, `scripts/build-whisper-runtime.mjs`.
- **Focus:** mic fallback / sidecar WAV conversion races; companion-audio mux sync; silence-detection thresholds; caption segmentation & parser edge cases; whisper runtime missing-model handling.
- **Method:** full read of every scoped file plus the contracts a finding's severity depends on (`electron/ipc/register/recording.ts`, `electron/ipc/register/captions.ts`, `src/hooks/useScreenRecorder.ts` stop/start sequences, `src/lib/exporter/audioRoutingEngine.ts`, `src/lib/mediaTiming.ts`, and the WGC helper C++ source `electron/native/wgc-capture/src/{main,mf_encoder}.cpp`). Findings only — no fixes proposed, no code changed.
- **Verification:** scoped unit tests run this session: `segment.test.ts`, `silence.test.ts`, `windows.test.ts`, `mac.test.ts`, `audioFilters.test.ts`, `diagnostics.test.ts`, `windowsFallbacks.test.ts`, `macCompanionAudio.test.ts` — 8 files / 71 tests, all passing (so the findings below are not covered by the current suite).

**Headline:** the two load-bearing facts were verified in the WGC helper source: the Media Foundation sink writer adds a single **video-only** stream (`mf_encoder.cpp:113-121` — no `MFMediaType_Audio` anywhere), so native Windows mp4s carry **no embedded audio**; and the helper writes per-sidecar timing metadata `{"startDelayMs": …}` (`main.cpp:209`). Everything audio-related on Windows rides on sidecar WAVs — which makes the captions candidate gap (M1) and the unused startDelay (M3) the two highest-impact issues.

---

## Findings

### MAJOR

**M1. Auto-captions can never transcribe native Windows recordings — `electron/ipc/captions/generate.ts:85-105`**

`resolveCaptionAudioCandidates` only ever offers `[video, linked webcam]`. `extractCaptionAudioSource` (`:121-153`) then runs `ffmpeg -map 0:a:0` against each candidate. But the WGC helper's mp4 has no audio stream (verified above), and the mic/system audio lives in `recording-<ts>.mic.wav` / `.system.wav` companions **next to the video** — paths this function never considers. The machinery to find them already exists (`getCompanionAudioFallbackInfo`, `diagnostics.ts:499-567`) and is used by the editor playback path, but not by captions.

*Repro:* record natively on Windows with system (or mic) audio enabled → open the editor → generate auto-captions → both candidates fail `-map 0:a:0` → user gets `"No audio was found to transcribe in the saved recording file…"` (`generate.ts:160-162`) even though a transcribable WAV sits beside the mp4. Auto-captions are dead on the flagship Windows flow.

**M2. Whisper runtime build failure is silently swallowed into release builds — `scripts/build-whisper-runtime.mjs:463-471`**

The per-target `catch` does `console.warn("… Continuing with bundled/available binaries.")` and `continue`s — **unconditionally**. The `isPostinstall`/`isCI`/`allowMissing` variables recomputed at `:464-466` are dead. This contradicts the script's own stated contract at `:372-376` ("Direct invocations (e.g. via `npm run build`, `build:win` …) must still fail loudly so we never ship a release build that is missing the whisper runtime") — which only the no-CMake branch (`:397-409`) honors. A release build where cmake configure/compile fails produces a shipped app with no `whisper-cli`; `resolveWhisperExecutablePath` (`generate.ts:42-83`) then falls through to PATH search or throws the generic "No Whisper runtime was found."

*Repro:* sabotage the configure step (e.g., rename a toolchain path) → `npm run build:win` succeeds → packaged app has broken auto-captions with no error at build time. Secondary: the source tarball is cached and reused without any checksum or integrity check (`:240-246`), so a truncated/corrupt `v1.8.4.tar.gz` fails tar on every retry but the build still soft-continues.

**M3. Companion-audio `startDelayMs` is recorded but never applied on playback or export — `src/components/video-editor/audio/useAudioPreviewSync.ts:418-432` and `src/lib/exporter/audioRoutingEngine.ts:80,96,112`**

The delay is faithfully produced end-to-end: WGC helper computes it against the video clock (`main.cpp:209`) and writes `<sidecar>.json`; the stop handler moves the json next to the final WAV (`register/recording.ts:972-975, 985-988`); the browser-fallback path measures it in the renderer (`useScreenRecorder.ts:1672-1675`, `Date.now() - mainStartedAt`) and persists it via `store-microphone-sidecar` metadata (`register/recording.ts:1642-1645`). But consumption is broken:

- Preview: mic companion tracks are matched by `/\.mic\./i` and **forced to `startDelaySeconds = 0`** (`useAudioPreviewSync.ts:424-432`); only system tracks use the recorded/inferred delay.
- Export: `buildResolvedAudioPlan` hardcodes `startDelayMs: 0` in every track's `sourceRef` (`audioRoutingEngine.ts:80,96,112`), so whatever consumes the plan can never see the recorded value.

*Repro:* browser mic fallback on a Bluetooth headset — `getUserMedia` negotiation takes ~0.5–2 s after the native video starts, so `micFallbackStartDelayMs ≈ 1000`. The mic WAV then leads the timeline by ~1 s in **both preview and export** (speech visibly/audibly early). The metadata that would fix it is written to disk and never read.

**M4. Concurrent model download corrupts the whisper model with no integrity check — `electron/ipc/captions/whisper.ts:118-156`, `electron/ipc/register/captions.ts:172-190`, `whisper.ts:29-44`**

`downloadWhisperSmallModel` has no in-flight guard: the shared temp `WHISPER_SMALL_MODEL_PATH + ".download"` (`:122`) is rm'd and re-created per call, and two overlapping HTTPS streams pipe into the same `createWriteStream` (`:82,105`) → interleaved bytes → `fs.rename(tempPath, WHISPER_SMALL_MODEL_PATH)` (`:139`) installs a corrupt model. `getWhisperSmallModelStatus` (`:29-44`) validates existence + `R_OK` only — no size or magic check — so `download-whisper-small-model` afterwards reports `alreadyDownloaded` (`register/captions.ts:174-182`) forever. Every transcription then fails with an opaque ggml loader error until the user manually deletes the model.

*Repro:* double-invoke the download IPC (double-click on a slow connection; two windows) → both progress streams interleave → rename → UI shows "downloaded" → `generate-auto-captions` fails on model load every time with no recovery hint. Related gap: the downloader has only a 30 s socket-inactivity timeout (`:53,109-111`), no overall deadline, and no content-length/size verification after finish.

---

### MINOR

**m1. `store-microphone-sidecar` uses a fixed shared temp path and ffmpeg writes the final WAV in place — `electron/ipc/register/recording.ts:1572-1603`**

`tempWebmPath = ${baseName}.mic.source.webm.tmp` and `sidecarPath = ${baseName}.mic.wav` are deterministic per video path; the webm is written directly (`:1578`) and ffmpeg transcodes **straight onto `sidecarPath`** (`:1600`) with no temp+rename. Two interleaved invocations for the same `finalPath` (e.g., a stop path racing the interrupted-handler path in `useScreenRecorder.ts`, or any renderer double-finalize) share the temp file: call B truncates the webm while call A's ffmpeg is decoding it, and readers of the companion path (`getUsableCompanionAudioCandidates`, `diagnostics.ts:415-448`) can stat a half-written WAV. A per-call unique temp plus rename-into-place is the missing primitive.

*Repro sketch:* fire `storeMicrophoneSidecar` twice ~1 s apart for the same `finalPath` (first webm is large and slow to IPC-copy) → the second `writeFile(tempWebmPath)` lands mid-transcode → first call emits a WAV built from the second recording's head, or fails and deletes the second call's output at `:1695-1698`.

**m2. 120 s conversion timeout on an unbounded webm with a heavy filter chain — `electron/ipc/register/recording.ts:1602`**

The sidecar transcode applies `adeclip + adeclick + highpass + lowpass + afftdn (+ speechnorm/alimiter)` (`audioFilters.ts:9-25`) over the whole recording under `timeout: 120000`. A multi-hour recording on a slow CPU (afftdn alone is far from realtime-cheap) can exceed 2 minutes → execFileAsync kills ffmpeg → the handler deletes the partial output and returns `{success:false}` → user toast "Recording was saved without the fallback microphone track." The timeout is constant, not scaled to input duration the way `getRecordingAudioMuxTimeoutMs` (`diagnostics.ts:108-118`) does for muxing.

**m3. Crash salvage abandons sidecar audio (and leaks it in %TEMP%) — `electron/ipc/recording/windows.ts:195-217`**

`attachWindowsCaptureLifecycle` salvages only the temp **video** into the recordings dir; the temp `morec-native-<ts>.system.wav` / `.mic.wav` and their timing `.json` are neither moved nor deleted, and their state handles are cleared (`:200-202`). The salvaged recording therefore has **no audio at all**, and every crash leaks orphaned WAVs in `%TEMP%` (nothing sweeps them on next start). Contrast macOS, where sidecars are written directly to final recordings-dir paths (`register/recording.ts:732-737`) and survive crashes by construction.

*Repro sketch:* kill `wgc-capture.exe` mid-take with system audio on → "Recording stopped unexpectedly" → recovered mp4 plays silent; `%TEMP%\morec-native-*.wav` accumulates per crash.

**m4. A hung stop strands the whole finished recording in %TEMP% with no Windows recovery — `electron/ipc/register/recording.ts:1132-1136`, `electron/ipc/recording/windows.ts:129-137`, `register/recording.ts:1283-1300`**

On stop timeout, `waitForWindowsCaptureStop` kills the helper and rejects; the lifecycle hook early-returns because `windowsCaptureStopRequested` is true (`windows.ts:184`), so no salvage runs. The stop handler's win32 branch only engages when `windowsNativeCaptureActive` is true — by then it is false — and the platform check at `register/recording.ts:1132-1136` returns "Native screen recording is only available on macOS." `recover-native-screen-recording` is darwin-only (`:1284-1288`). Renderer recovery (`recoverNativeRecordingSession`, `useScreenRecorder.ts:924-977`) therefore also returns null on Windows.

*Repro sketch:* wedge the helper's stop path (WGC session hang) → 45 s timeout → toast "Failed to finish the recording" → a fully recorded take remains as `morec-native-<ts>.mp4` + sidecars in `%TEMP%`, unreachable by any recovery flow, until temp cleanup discards it.

**m5. WASAPI mic-fallback detection is a one-shot snapshot at start — `electron/ipc/recording/windowsFallbacks.ts:24-34`, `register/recording.ts:581-589`**

`shouldUseWindowsBrowserMicrophoneFallback` is evaluated exactly once, immediately after `waitForWindowsCaptureStart` resolves, against whatever output chunks have arrived. A WASAPI init warning printed *after* "Recording started" (device disappears on startup, exclusive-mode grab) is never seen: `microphoneFallbackRequired:false` was already returned, the native mic path stays reserved, and the take records with a dead/partial mic track. Conversely a warning chunk in flight at check time can flip fallback on even though native mic then initializes fine (minor over-trigger).

**m6. One malformed token drops all word timing for a segment, which downgrades the whole transcript — `electron/ipc/captions/parser.ts:52-54`, `electron/ipc/captions/generate.ts:107`, `electron/ipc/captions/segment.ts:115-117`**

`parseWhisperJsonWords` returns `[]` for the entire token list if *any* token has `offsets.from == null`, `offsets.to == null`, or `to <= from`. The cue then falls back to plain segment text (`generate.ts:107`), and because `hasWordTimings` is all-or-nothing across cues (`segment.ts:115-117`), a **single** zero-duration token (whisper.cpp emits `from==to` for some special/hallucinated tokens) pushes the whole transcription onto the silence-only path: proportional sentence timing instead of word timing everywhere.

**m7. SRT fallback parser edge cases — `electron/ipc/captions/parser.ts:128-141, 143-177`**

(a) `parseSrtTimestamp` requires exactly two-digit hours (`^(\d{2}):`), so `0:00:05,000` (written by several tools) drops the cue silently. (b) Text is taken after `lines.indexOf(timingLine)` — if a caption's text line equals the timing line string, content truncates. (c) A blank line inside a cue (legal in the wild) splits the block; the continuation has no `-->` line and its text is dropped. All three fail quiet: cues vanish rather than error.

**m8. `padSpans` can emit overlapping cues when word timings straddle a pause — `electron/ipc/captions/silence.ts:174-193`**

Padding clamps against neighbors assuming disjoint spans (`Math.max(0, rawStart - prevEndMs)`), but pieces are word-derived and a whisper word stretched across a 1.5 s pause can belong to piece *i* while ending after piece *i+1* starts. Then `nextStartMs - rawEnd` is negative → `rightPad` is negative → the span is not pulled back and the cues overlap on the timeline. `segmentCuesIntoPhrases` merges before padding (`segment.ts:452-457`) but never re-checks ordering after it.

**m9. Waveform generation fetches and decodes the entire file in memory — `src/components/video-editor/audio/waveform/WaveformGenerator.ts:91-102`**

`fetch(url)` → `arrayBuffer()` → `decodeAudioData` materializes the full compressed file **and** the full float32 PCM. A 2 h mono 48 kHz WAV companion ≈ 690 MB compressed-buffer + ~1.4 GB decoded — the renderer can OOM/crash. `MAX_WAVEFORM_PEAKS` (200k, `:6`) bounds only the *output*, and nothing streams or downsamples the input. This is the most plausible renderer-crash path when opening long recordings.

**m10. Webcam-fallback captions come back on the webcam's timeline, uncorrected — `electron/ipc/captions/generate.ts:101-104, 144`**

When the screen recording has no audio but a linked webcam does, the wav is extracted from the webcam file and cues are returned with webcam-relative timestamps. The caller only surfaces `audioSourceLabel` (`register/captions.ts:240-243`); the session's webcam `timeOffsetMs` (tracked in `useScreenRecorder.ts:1628-1631`) is never applied, so captions are shifted by the webcam start offset.

**m11. `store-microphone-sidecar` writes to a renderer-chosen path with no validation — `electron/ipc/register/recording.ts:1572-1574, 1667-1676`**

`baseName = videoPath.replace(/\.[^.]+$/, "")` — the handler will write `<any renderer string>.mic.wav`, `.mic.source.webm(.tmp)`, `.mic.wav.json`, and a recording-diagnostics json derived from it, anywhere the renderer names (the sibling `store-recorded-video` handler, by contrast, routes through `resolveRecordedVideoStoragePath`). Not exploitable from a normal flow, but it breaks the write-confinement pattern used elsewhere and hands a compromised renderer an arbitrary-suffix file write.

---

### LOW

**L1. `.bat`/`.cmd` whisper picker entries cannot actually run — `electron/ipc/register/captions.ts:118-127` vs `generate.ts:239,253`**
The file dialog advertises `exe, cmd, bat`, but Node ≥ 18.8 refuses to spawn `.bat`/`.cmd` via `execFile` without `shell` (EINVAL, post-CVE-2022-24999 hardening) — selecting a batch wrapper yields an opaque failure.

**L2. Windows companion naming hardcodes `.wav` and diagnostics-only fields — `electron/ipc/recording/windows.ts:248,270,259-262,279-284`**
`muxNativeWindowsVideoWithAudio` renames any sidecar to `*.system.wav` / `*.mic.wav` regardless of actual container (mac preserves source extension, `macCompanionAudio.ts:14-15`), and reports `durationSeconds: 0` / `startDelayMs: null` / `muxed: false` unconditionally. Harmless today (WAV-only, result used for diagnostics), but the fields invite misuse.

**L3. Invalid-window early return leaks staged capture state — `electron/ipc/register/recording.ts:441-471`**
`setWindowsCaptureTargetPath/TempPath` are set before the `invalid-window` return, which clears neither (nor system/mic paths set later would be, since they're set after). Stale paths persist until the next start overwrites them.

**L4. Stale comment on the sidecar-keep env flag — `electron/ipc/recording/audioFilters.ts:35`**
`RECORDING_AUDIO_SIDECAR_DEBUG_ENV` is annotated "not used yet", but `shouldKeepRecordingAudioSidecars` gates real behavior (temp-webm retention `register/recording.ts:1604-1611`, orphan-cleanup skip `:346-357`).

**L5. Preview companion sync tolerates up to ~0.9 s drift by design — `useAudioPreviewSync.ts:451-456`**
Source tracks run at fixed playback rate with a 0.9 s seek threshold (deliberate, per the KISS comment); visible desync before correction is bounded but perceptible. Noted as a tradeoff, not a defect.

---

## Silence-detection thresholds — assessment (explicitly requested)

Parameters: `SILENCE_NOISE_DB = -30`, `SILENCE_DETECT_MIN_S = 0.5` (`silence.ts:18-21`) → ffmpeg `silencedetect=noise=-30dB:d=0.5` (`generate.ts:178`); split threshold 1500 ms, edge pad 80 ms, min speech 150 ms (`silence.ts:23-27`); word-gap phrase break 700 ms (`segment.ts:27`).

The interplay is coherent: silencedetect only reports silences ≥ 0.5 s, mid-transcript silences of 0.5–1.5 s are deliberately absorbed (boundaries need ≥ `splitSilenceMs` or edge-touching, `silence.ts:224-236`), trailing silence to EOF is handled via the `POSITIVE_INFINITY` interval (`:81-84`), and negative `silence_start` values are clamped (`:67`). `gapMs > 0` guards `silenceInGap` so overlapping/abutting words can't manufacture bogus splits (`segment.ts:412-415`). Three risks worth flagging:

1. **-30 dB on quiet speech**: the wav is extracted mono 16 kHz from whichever candidate wins (`generate.ts:124-141`); far-field mics or low-gain headsets put real speech under -30 dB → stretches count as silence → words dropped by `dropHallucinations` (`segment.ts:139-157`) or whole <150 ms regions filtered (`silence.ts:238-240`). This failure is silent (captions just get shorter).
2. **Threshold coupling**: `SILENCE_DETECT_MIN_S` (0.5) and `splitSilenceMs` (1.5) are independent constants fed from different layers; if someone tunes `splitSilenceMs` below 500 ms it silently stops splitting (ffmpeg never reported the interval), which is non-obvious.
3. **`detectSilenceIntervals` runs on the *extracted wav*, not the timeline audio**: if the winning candidate is the webcam (m10) the silences are on the wrong clock too — same root cause as m10.

## Companion-audio mux sync — assessment (explicitly requested)

Both platforms now ship sidecars instead of muxing (`windows.ts:233-301`, `mac.ts:145-177`). The sync chain verified end-to-end: helper QPC-derived `startDelayMs` json (`main.cpp:209`) → stop handler moves wav+json to final names (`register/recording.ts:966-990`) → editor reads them via `getCompanionAudioStartDelayMs` (`diagnostics.ts:466-474`) → preview applies for system tracks only (`useAudioPreviewSync.ts:419-432`) → **export applies nothing** (`audioRoutingEngine.ts:96,112`). So: native system audio is correctly aligned in preview but not export; native mic (tiny delay) is fine in practice; browser mic fallback (potentially large delay) is misaligned everywhere — that is M3. Secondary observations: the stat-then-move windows in `windows.ts:250-253, 271-274` are benign because mux runs strictly after helper exit and after the stop handler's own moves; the mac/windows extension-naming divergence is L2; crash/timeout audio loss is m3/m4.
