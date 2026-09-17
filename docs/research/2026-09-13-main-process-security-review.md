> **Status (2026-09-17):** Resolved. Every actionable finding was remediated in PR #23 (H1–H3, M1, M2, M4, M5, L1–L6 — each independently verified and adversarially re-reviewed). **M3** (Authenticode anchor for updates) is a release-engineering dependency requiring a code-signing certificate; **L3** was verified as a Windows no-op. Accepted residuals are documented in [2026-09-16-main-process-security-remediation.md](2026-09-16-main-process-security-remediation.md). Consolidated to main from review PR #4 before closing it; this file is the record copy.

# Security review — MoRec Electron main process (Windows)

- **Date:** 2026-09-13
- **Scope:** `electron/main.ts`, `electron/preload.ts`, `electron/windows.ts`, `electron/ipc/handlers.ts` + `electron/ipc/register/*`, `electron/navigationPolicy.ts`, `electron/permissionPolicy.ts`, `electron/mediaServer.ts`, `electron/ipc/approvedPaths.ts`, `electron/ipc/paths/binaries.ts`, `electron/updater.ts`, `electron/extensions/*` (plus supporting modules read for tracing: `ipc/state.ts`, `ipc/utils.ts`, `ipc/project/manager.ts`, `ipc/export/*`, `ipc/recording/*`, `rendererServer.ts`, `src/lib/extensions/extensionHost.ts`).
- **Reviewed state:** working tree of `review/audio-captions-pipeline` (`main` at `e6e7aee`). The only uncommitted in-scope change was `mediaServer.ts` (test-only `closeMediaServer()` helper — not security-relevant).
- **Method:** manual code read of every handler channel registered in `register/` plus all main-process spawn/exec/file-IO sites; no PoCs were executed. Line numbers are from the reviewed state.
- **This is findings-only.** No fixes are proposed or implemented.

## Threat model used throughout

All windows share one preload bridge (`preload.ts`) exposing ~120 invoke channels to any renderer window. Windows are `contextIsolation: true`, `nodeIntegration: false` (windows.ts:415-421, 640-645, 831-836, 903-907). The main-process handlers are therefore the security boundary for the renderer, and the review assumes a **compromised renderer** (XSS in the bundled UI, a compromised npm dependency, or a malicious installed extension — see H3) as the attacker position. The codebase explicitly states this model in places (e.g. `electron/ipc/register/assets.ts:42` "The renderer is untrusted"; `approvedPaths.ts` header), so findings below are judged against that own stated bar.

---

## High

### H1 — The read allowlist is writable from the renderer → arbitrary file read

The global read allowlist `approvedLocalReadPaths` (`electron/ipc/state.ts:26`) is treated as untrusted-renderer-proof by `read-local-file` (`electron/ipc/register/assets.ts:141-156` → `isAllowedLocalReadPath`, `electron/ipc/project/manager.ts:52-95`, which also does symlink canonicalization). But three IPC handlers add renderer-supplied paths to that allowlist unconditionally:

- `get-video-audio-fallback-paths` → `rememberApprovedLocalReadPath(videoPath)` for the renderer path **and** every derived fallback path (`electron/ipc/register/recording.ts:1421-1437`; approval itself is unconditional at `electron/ipc/project/manager.ts:127-136`, adding both lexical and realpath).
- `set-current-video-path` → `approveUserPath(currentVideoPath)` + `replaceApprovedSessionLocalReadPaths([...])` (`electron/ipc/register/project.ts:629-673`, approval at 637 and 652-655).
- `set-current-recording-session` → `rememberApprovedLocalReadPath` on both session paths (`electron/ipc/register/project.ts:675-711`, approvals at 696-697).

- **Precondition:** script execution in any renderer window. One invoke of any of the three channels with an arbitrary path (e.g. `C:\Users\<user>\Documents\…`, SSH keys, browser profile files), then one `read-local-file` invoke — the file is returned as raw bytes (no extension restriction; `assets.ts:141-156` only requires an existing file). `get-local-media-url` (`project.ts:819-831`) additionally serves media-extension files over the loopback media server. Note the poisoning adds both the lexical and canonical path, so the symlink hardening in `isAllowedLocalReadPath` (`manager.ts:66-94`) is bypassed along with the prefix list.
- **Impact:** read/exfiltrate any file the user account can read, from a renderer compromise, without dialogs or prompts. This single gap also invalidates the careful per-handler read gating elsewhere (`export.ts:147-185`, `assets.ts:34-47`), because approval can be self-granted.
- Contrast: `approveUserPath` is used correctly after dialogs in `captions.ts:64,100,133,156`, `assets.ts:28`, and `export.ts:884,944,1012,1058` — those are user-consented. The three channels above accept renderer-chosen paths instead.

### H2 — `generate-auto-captions` executes a renderer-chosen executable (RCE out of the renderer sandbox)

- The renderer supplies `whisperExecutablePath` (`electron/preload.ts:723-730`); the handler forwards it verbatim (`electron/ipc/register/captions.ts:224-254`). `resolveWhisperExecutablePath` puts the renderer-supplied path **first** in the candidate list and returns it if it exists and is executable (`electron/ipc/captions/generate.ts:42-92`, preferred path at 49), after which the main process runs it: `execFileAsync(whisperExecutablePath, …)` (`generate.ts:239` and `253`).
- A compromised renderer can stage an arbitrary binary in the temp dir through app IPC: `export-stream-open` accepts `extension: "exe"` (allowlist `/^[a-z0-9]{1,8}$/` — `electron/ipc/export/exportStream.ts:20,54-57`), `export-stream-write` fills it with attacker bytes, and the returned temp path is fed to `generate-auto-captions`.
- **Precondition:** script execution in a renderer window; two additional IPC invokes.
- **Impact:** arbitrary native code execution in the main process (user-level). This is strictly stronger than the read primitive in H1: no sandbox, full OS-level capability. Same-shape risk: `WHISPER_CPP_PATH` env fallback (`generate.ts:56`).

### H3 — Extension system ships arbitrary code into the renderer; permission gating is renderer-side best-effort

- Marketplace install is well-gated at the transport layer (origin allowlist `https://marketplace.morec.app` / `https://morec.app`, id regex, zip-slip post-scan — `electron/extensions/extensionMarketplace.ts:176-196, 37-53, 266-272`), and user extensions default to `installed`, not `active` (`electron/extensions/extensionLoader.ts:278-287`). But the installed payload is arbitrary JavaScript, executed in the renderer **main world** via dynamic `import()` (`src/lib/extensions/extensionHost.ts:210-213`).
- The only control between extension code and the full preload bridge is a same-realm JS swap that hides `window.electronAPI` during import+activate and restores it afterwards (`src/lib/extensions/extensionHost.ts:32-73`, restore/use of the stashed real reference at 1089). That is not a security boundary: code running in the same JS realm can retain references across async continuations, and every extension callback that fires outside the guarded window sees the restored real API. The manifest `permissions` list (`extensionLoader.ts:135-147`) is enforced, if at all, only in that same renderer-side layer — the main process cannot see it.
- **Precondition:** a user installs a malicious extension (the marketplace review process is the actual gate), or a same-privilege local process drops files into `%APPDATA%/MoRec/extensions/` (auto-registered on next `extensions:discover`).
- **Impact:** full renderer compromise, which chains directly into H1 and H2 (and every Medium below). Worth an explicit product decision: either extension code must run in an isolated context, or the marketplace review process must be treated as the sole security control and documented as such.

---

## Medium

### M1 — `set-recording-preferences` merges an unvalidated renderer object; `recordingsDir` from that file redirects all recording writes

- `app-settings:set`-style spread: the handler writes `{ ...existing, ...prefs }` with the renderer's object accepted whole (`electron/ipc/register/settings.ts:251-283`, merge at 271) into `recordings-settings.json`. The preload type promises only mic/webcam keys (`preload.ts:1012-1018`), but that is a compile-time fiction across IPC.
- `getRecordingsDir()` later trusts `recordingsDir` from that same file (`electron/ipc/utils.ts:110-133`). All recording outputs then follow: native Windows capture output/cwd (`electron/ipc/register/recording.ts:437-439, 557`), mic/system sidecars (515, 733-736), and `store-recorded-video` (`recording.ts:1705-1719` + `electron/ipc/recording/storagePath.ts:5-24`).
- The file-name side is well-guarded (strict `recording-\d+(-webcam)?\.(webm|mp4)` regex + traversal check in `storagePath.ts`) — but the directory is renderer-chosen.
- **Precondition:** renderer script execution; one `set-recording-preferences` invoke with `{ recordingsDir: "…" }`, then a normal recording or `store-recorded-video`.
- **Impact:** attacker-chosen directory receives attacker-content files with fixed `recording-*.mp4/.wav` names (file planting, overwrite of existing `recording-*.mp4` anywhere, disk-fill DoS, silent redirection of the user's recordings). The legitimate path (`choose-recordings-directory`, `project.ts:283-313`) is dialog-gated — the settings merge bypasses it.

### M2 — `store-microphone-sidecar` and cursor telemetry derive all file paths from renderer input

- `store-microphone-sidecar`: `baseName = videoPath.replace(/\.[^.]+$/, "")` with **no validation** on `videoPath`; then writes `<base>.mic.source.webm.tmp` (raw renderer bytes), ffmpeg output `<base>.mic.wav`, `<base>.mic.wav.json` (`electron/ipc/register/recording.ts:1554-1603`, path derivation 1572-1575), plus a diagnostics JSON at `<base>.recording-diagnostics.json` (`electron/ipc/recording/diagnostics.ts:305, 369-412`). Absolute paths — including UNC (`\\server\share\…`) — are accepted.
- `set-cursor-telemetry` / `get-cursor-telemetry`: writes/deletes `<videoPath>.cursor.json` and reads any file as JSON from the renderer path (`recording.ts:1823-1877`; write/delete at `electron/ipc/cursor/telemetry.ts:83-97`).
- **Precondition:** renderer script execution; single invoke with an arbitrary absolute path.
- **Impact:** arbitrary-location file write/delete with fixed suffixes and constrained content (`.mic.wav`, `.mic.wav.json`, `.cursor.json`, `.recording-diagnostics.json`), arbitrary-directory file planting, overwrite of existing files with those suffixes, disk fill. The suffix constraint keeps this below the export-stream primitive in H2, but it is the same class of gap that `store-recorded-video` deliberately closed (`storagePath.ts`) and these handlers missed.

### M3 — Windows updates have no Authenticode anchor; integrity rests entirely on the GitHub feed

- Windows target is unsigned NSIS with no `publisherName`/signing config (`electron-builder.json5`, `win` block); `electron-updater@^6.8.3` only performs Authenticode verification of the downloaded installer when a publisher name is configured. There is none, so the only integrity checks are TLS to the feed and the `sha512` in `latest.yml` — served from the same feed.
- Secondary channel risk: `MOREC_UPDATE_FEED_URL` switches the feed to an arbitrary generic provider (`electron/updater.ts:12, 113-125`). Requiring local env control, it is not attacker-interesting on its own, but it means the update channel has no pinned cryptographic anchor anywhere.
- The auto-install UX (notification click → download → `quitAndInstall`, `electron/main.ts:633-656`, `updater.ts:372-385`) is user-gated and `autoDownload`/`autoInstallOnAppQuit` are off (`updater.ts:653-654`) — good — but none of that substitutes for a signature check.
- **Precondition:** compromise of the GitHub release feed or repo publish credentials.
- **Impact:** malicious installer executes at update time with no local verification failing.

### M4 — Media server: no Host-header validation (DNS rebinding) and no token; loopback-wide CORS

- The media server binds `127.0.0.1:0`, requires the exact `/video` route, realpath-resolves, and checks the `approvedLocalReadPaths` allowlist (`electron/mediaServer.ts:94-115, 249`) — the path handling is solid, and the earlier wildcard-CORS exfiltration was fixed to loopback-only origins (`mediaServer.ts:66-87`).
- Remaining: no `Host` header check, so a DNS-rebinding page (attacker domain resolving to 127.0.0.1) makes requests **same-origin** and CORS no longer applies; any non-browser local process can also `GET /video?path=<approved>` directly with no token (the port is random per session but trivially enumerable locally).
- **Precondition:** (a) victim visits attacker page during a session with approved paths, or (b) any unprivileged local process. Content is whatever `approvedLocalReadPaths` holds — which H1 lets the renderer expand arbitrarily, compounding both.
- **Impact:** cross-origin/local read of approved media files. Same no-Host-check shape applies to the packaged renderer static server (`electron/rendererServer.ts`), which only serves `dist/` files (low sensitivity).

### M5 — Marketplace download: redirect-following bypasses the origin allowlist; no artifact integrity

- `downloadAndInstallExtension` validates the **initial** URL's origin (`extensionMarketplace.ts:176-188`) but the subsequent `fetch` follows redirects to any origin by default (`extensionMarketplace.ts:209-217`), and the downloaded zip has no checksum/signature check against marketplace metadata (HTTPS only).
- **Precondition:** a compromised/abused marketplace server or CDN path that answers the extension request with a redirect (or wrong content).
- **Impact:** arbitrary extension payload delivered through the trusted-origin gate; chains into H3. The zip-slip scan (`37-53`) covers path traversal but not content provenance.

---

## Low

### L1 — `reveal-in-folder` opens renderer-chosen paths/folders in Explorer
`electron/ipc/register/project.ts:218-240` — `shell.showItemInFolder` / `shell.openPath(dirname)` on an arbitrary renderer path. Reveal-only (no execution), but lets a compromised renderer pop Explorer at any location, e.g. to lend credibility to a phishing flow.

### L2 — Read allowlist includes the whole system temp directory
`manager.ts:52-58` allows everything under `app.getPath("temp")` as a prefix. `read-local-file` can therefore read any other application's temp files for the same user (shared directory), independent of H1 poisoning.

### L3 — Native helper binaries resolved/executed from user-writable `userData`
`electron/ipc/paths/binaries.ts:88-114` runs helpers from `%APPDATA%/MoRec/native-tools` (macOS compile-from-source path; Windows prefers the prebundled binary first — good). Any same-privilege process can swap the binary for the non-prebundled names. Standard binary-planting surface, same-privilege precondition only.

### L4 — Admin marketplace API reachable from every renderer when `MOREC_ADMIN_KEY` is set
The full admin review surface (`extensions:reviews-list`, `extensions:review-update`) is exposed through the shared preload (`electron/preload.ts:1056-1059`) and sends the env-provided key as `X-Admin-Key` from the user-facing client (`extensionMarketplace.ts:61-63, 84-89`). The control is "env var set on one machine", with no per-window or per-user gating.

### L5 — `open-external-url` passes the raw string to `shell.openExternal`
`electron/ipc/register/permissions.ts:5-18` validates the protocol via `new URL(url)` but then opens the **original string** rather than `parsed.href`. Protocol is enforced (http/https only), so the residual risk is normalization differences between WHATWG URL and the OS shell handler; `navigationPolicy.ts:69-84` does it more strictly (opens the normalized `href`, rejects userinfo).

### L6 — `app-settings:set` accepts arbitrary key/value pairs
`electron/ipc/register/settings.ts:167-181` persists any renderer-provided key/value into `app-settings.json`. Config poisoning of whatever future code trusts that store (M1 is the existing instance of this pattern, in a different file).

---

## Info / positive controls (verified, not just assumed)

- **Navigation hardening is genuinely good** (`electron/navigationPolicy.ts:90-151` + `main.ts:89-95`): last-committed-URL trust anchor (history-API proof), reload-only navigation allowance, `will-redirect` denied, `window.open` always denied with http/https-only external handoff, no `file:`/custom-scheme escape in `normalizeExternalHttpUrl` (`navigationPolicy.ts:15-31`). Drag-drop cannot navigate: dropped files surface as paths via the file-approval channels reviewed above, not as navigations.
- **Capture permissions are tightly scoped** (`electron/permissionPolicy.ts`): exact `windowType=hud-overlay` query + base-URL pathname equality + security-origin cross-check for both `media` and display-capture (`main.ts:958-995, 1114-1177`); device permission handler denies by default (`main.ts:998`).
- **Export write path is the model the rest should follow**: dialog/app-registered destinations only, rebuilt from root+basename (`electron/ipc/approvedPaths.ts:14-49`), owned-temp registry for finalize/discard/mux (`electron/ipc/register/export.ts:967-1099`, `electron/ipc/export/exportStream.ts`), per-session 0700 dir + `O_EXCL` (`exportStream.ts:58-87`). `write-exported-video-to-path` and `finalize-exported-video` correctly reject renderer-chosen destinations.
- **`store-recorded-video`** is correctly hardened (`recording.ts:1705-1719` + `storagePath.ts`), as is **`delete-recording-file`** (realpath + inside-real-recordings-dir + auto-recording prefix, `project.ts:734-817`).
- **`native-static-layout-export`** validates every renderer path through the allowlist (`export.ts:187-241`) — note its sibling `native-video-export-finish` / `mux-exported-video-audio(-from-path)` do **not** apply the same check to `audioOptions.audioSourcePath` (`electron/ipc/export/native-video.ts:4107`), a same-shape inconsistency worth a look alongside M2.
- **Updater defaults** are conservative: `autoDownload`/`autoInstallOnAppQuit` off (`updater.ts:653-654`).
- **Whisper model download** is a pinned HTTPS HuggingFace URL into userData (`electron/ipc/constants.ts:19-22`), no user/agent-controlled URL input.
- **ffmpeg resolution** prefers the bundled `ffmpeg-static` and falls back to `where ffmpeg` on PATH (`electron/ipc/ffmpeg/binary.ts`) — PATH-based fallback is standard and only matters if the attacker already controls the user's PATH.

## Secrets

- No `.env` file exists in the working tree and none was ever committed (`git log --all --diff-filter=A -- .env*` empty). No credential patterns (`ghp_`, `AKIA…`, `sk-`, Slack tokens, private key blocks) in tracked files.
- The main process reads configuration exclusively from env vars: `MOREC_UPDATE_FEED_URL`, `MOREC_DISABLE_AUTO_UPDATES`, `MOREC_UPDATER_LOG_PATH`, `MOREC_MARKETPLACE_URL`, `MOREC_ADMIN_KEY`, `MOREC_BROWSER_MIC_PROFILE`, `MOREC_SMOKE_EXPORT_*`, `MOREC_EXPERIMENTAL_NVIDIA_CUDA_EXPORT`, `WHISPER_CPP_PATH`, `VITE_DEV_SERVER_URL` (dev). Of these, `MOREC_ADMIN_KEY` (L4) and `MOREC_UPDATE_FEED_URL` (M3) are the two with security weight; the rest are dev/smoke toggles.
