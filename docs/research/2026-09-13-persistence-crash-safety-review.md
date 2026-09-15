# MoRec Project Persistence & Crash Safety Review (Windows)

> **Status (2026-09-16):** Resolved. All 16 findings were fixed in PR #15 (merged 2026-09-15). Consolidated to main from review PR #7 before closing it; this file is the record copy.

**Date:** 2026-09-13 · **Scope:** Windows-only · **Mode:** findings-only, no fixes applied

Scope covered: `electron/ipc/project/` (`manager.ts`, `session.ts`, `atomicSave.ts`), `electron/appPaths.ts`, `electron/ipc/register/project.ts`, `src/components/video-editor/projectPersistence*`, the `.morec-session.json` lifecycle in `src/hooks/useScreenRecorder.ts`, the `delete-recording-file` sidecar cleanup, and the adjacent test files (`project*.test.ts`, `atomicSave.test.ts`). Findings are severity-ordered; each names file:line and the concrete data-loss scenario.

**Verdict in one line:** the atomic-save core (`atomicSave.ts`) is genuinely well built — fsync'd temp file, backup generation, rename commit, per-path write queue — but everything *around* it is non-atomic plain `fs.writeFile` (recents, recordings-settings, session manifest, thumbnails, recorded video), the `.bak` it produces is never read by any load path, and `delete-recording-file` can destroy sidecar audio while reporting success.

---

## High

### H1 — `delete-recording-file` swallows a failed main-video unlink, then destroys all sidecars and reports success
`electron/ipc/register/project.ts:750` vs `:781-787`, return at `:813`

The handler unlinks the main video with `.catch(() => undefined)` **before** deleting sidecars, and every sidecar unlink is also swallowed. If the main unlink fails (EBUSY/EPERM — the file is open by a running ffmpeg export reading the source, an external player, an antivirus scan, or a backup tool that opened it without `FILE_SHARE_DELETE`), execution continues, every `.mic.wav` / `.system.wav` / `.mic.source.webm` / `.diagnostics.json` / `.morec-session.json` companion is deleted, and the handler returns `{ success: true }`.

**Data-loss scenario:** user deletes a recording that is currently the export source (or is locked transiently by AV). Delete "succeeds" per the UI, but the video file remains in the folder while its separate microphone/system audio tracks and diagnostics are permanently destroyed. A later retry deletes the video, and the audio sidecars are unrecoverable. There is no reassociation path.

Related, same block: a crash or forced kill between the main `unlink` (`:750`) and the sidecar `Promise.all` (`:781-787`) also leaves all sidecars orphaned with no startup sweep to ever clean them.

---

## Medium

### M1 — Opening the project library permanently prunes recents; the truncation is not recency-ordered
`electron/ipc/project/manager.ts:402-404` + `:302-305`, cap at `electron/ipc/constants.ts:9`

`listProjectLibraryEntries` ends by saving `Set([...entries.map(e => e.path), ...recentProjectPaths])` — i.e. **every readable project found in the Projects directory first**, then remaining recents — into `saveRecentProjectPaths`, which dedupes and then `.slice(0, MAX_RECENT_PROJECTS)` with `MAX_RECENT_PROJECTS = 16`.

**Data-loss scenario:** user has >16 `.morec` files in the Projects directory and some projects saved to other locations (only referenced by recents). Every time the library is listed, the slice keeps the first 16 array entries — Projects-dir entries in readdir order — and silently drops the external recents. The pointers are gone forever (the project files still exist, but nothing in the app remembers them). The order kept is not even "16 most recent": `entries` is sorted by `updatedAt`, but recents displaced by dir entries are lost regardless of age.

Note the existing test hides this: `manager.recents.test.ts:62` mocks `MAX_RECENT_PROJECTS: 3` but its listing test (`:154-171`) uses only 1 dir entry + 2 recents, so the truncation path never fires.

### M2 — Recents, recordings-settings, and thumbnails are written non-atomically; corruption resets silently
`electron/ipc/project/manager.ts:250` (recordings-settings), `:306` (recents), `:282` (thumbnail); fallback behavior at `electron/ipc/utils.ts:123-125` and `manager.ts:296-298`

Project files go through `writeProjectFileAtomically`, but every other persistent store is a bare `fs.writeFile`. A crash or power loss mid-write truncates the JSON; the readers treat that as "no data":

- `recent-projects.json` torn → `loadRecentProjectPaths` catch returns `[]` (`manager.ts:296-298`) → the next save overwrites the file with whatever is in memory. Recents list silently resets.
- `recordings-settings.json` torn → `loadRecordingsDirectorySetting` catch sets `customRecordingsDir = null` (`utils.ts:123-125`) → the app silently reverts to the default `%APPDATA%/MoRec/recordings`. The user's recordings still exist in the custom directory, but the app no longer knows about it — it *looks* like the library vanished, and new recordings land in the default dir, splitting the library across two roots.
- Thumbnails torn → harmless decode failure (worst case a missing preview).

**Data-loss scenario (recents/settings):** power loss during any save/list operation corrupts the store; on next launch the recents list is empty and/or the custom recordings root is forgotten without any error or recovery prompt.

### M3 — Recents read-modify-write races (three unsynchronized writers)
`electron/ipc/project/manager.ts:313-320` (`rememberRecentProject`), `:402-404` (listing), `electron/ipc/register/project.ts:483-491` (rename-mode filter)

Three code paths independently do read-recents → modify → `saveRecentProjectPaths` with no shared queue (`pendingWrites` in `atomicSave.ts` covers only project files). Interleaved IPC calls (e.g. `save-project-file` following a `list-project-files`, or named-rename filtering while a save remembers) lose whole recents entries last-writer-wins. On Windows, two concurrent `fs.writeFile` opens can also interleave bytes in the same file (libuv shares read/write/delete), producing a corrupt store on top of the lost update.

**Data-loss scenario:** save a project while the library is refreshing → one writer's recents snapshot wins → a recently-saved external project drops off the recents list.

### M4 — Session manifest (`.morec-session.json`) is written non-atomically; a torn write silently resets webcam sync offset
`electron/ipc/project/session.ts:41` (bare `fs.writeFile`); recovery fallback `:123-141`

The manifest is the only durable record of `timeOffsetMs` for webcam-linked sessions and is rewritten whenever the session changes (`register/project.ts:658, 701`; driven from `useScreenRecorder.ts:695-700` at finalize). A crash mid-write leaves a partial JSON; `resolveRecordingSessionManifest` catch returns `null` (`session.ts:85-87`), and `resolveRecordingSession` falls back to the `-webcam` filename convention (`session.ts:136-140`).

**Data-loss scenario:** crash while a webcam session is active → on recovery the webcam file relinks (good) but `timeOffsetMs` resets to 0 → the restored session has audio/video desync the user had explicitly corrected. The file exists precisely to survive crashes and is the one file most likely to be mid-write during one.

### M5 — Manifest `webcamFileName` is joined unvalidated; a poisoned manifest adds an arbitrary path to the read allowlist
`electron/ipc/project/session.ts:74` (`path.join(dirname, webcamFileName)`); approval flows `manager.ts:486`, `register/project.ts:652-655`

`webcamFileName` is read from whatever `.morec-session.json` sits next to a video and joined to the video's directory without a basename check. A manifest containing `webcamFileName: "..\\..\\secret.mp4"` (or an absolute path) resolves to a file outside the recordings tree, which is then fed into `replaceApprovedSessionLocalReadPaths` / session approval and becomes fetchable via the media server. This is the persistence-surface variant of the allowlist-poisoning class flagged in the earlier main-process security review (PR #4 H1): anyone/anything that can write a sidecar file next to a video the user opens controls what gets allowlisted.

### M6 — `.bak` generations are written but never consumed — half-implemented crash recovery
`electron/ipc/project/atomicSave.ts:18-20, 88-105`; no read path: `getProjectBackupPath` is only referenced by the writer (`atomicSave.ts:110`) and rename-mode cleanup (`register/project.ts:480`)

`writeProjectFileAtomically` carefully preserves the previous generation as `<project>.morec.bak`, but `loadProjectFromPath` (`manager.ts:435-447`) has no fallback: if the main file fails to parse (disk corruption, partial legacy write, external tool damage), the user gets "Failed to read project file" while a valid backup sits in the same directory. All the crash-safety machinery on the write side has no counterpart on the read side.

**Data-loss scenario:** a project file is corrupted outside the atomic writer's guarantees → all edits are lost even though the last complete generation is one `.bak` away, and nothing tells the user it exists.

### M7 — Named save blocks overwriting the user's own legacy project file
`electron/ipc/register/project.ts:197-207`

`ensureNamedProjectSaveDoesNotOverwriteDifferentProject` falls through to "Unable to verify project identity for the chosen name" whenever the on-disk file has no `projectId` but the incoming payload does — which is exactly the case when re-saving a project created before `projectId` was introduced. Since the incoming payload always gets an ID (`:125-139`), every legitimate overwrite of an old file via named save is blocked; the video-path-equality branch at `:190` can't rescue it because `:197` requires *both* to lack IDs.

**Scenario (not data loss, a save-blocking defect):** user opens an old project, hits named save with the same name → permanently refused, must fall back to the Save-As dialog. The check is safe-direction, but the identity logic has a hole for the most common legacy case.

---

## Low

### L1 — Crash-orphaned `.morec-project-*.tmp` / `.morec-backup-*.tmp` files are never swept
`electron/ipc/project/atomicSave.ts:27-29, 120-125`

The `finally` cleanup only runs in-process. A hard crash between `writeSyncedTemporaryFile` and the renames leaves hidden `.tmp` files (including partial `copyFile` output from `preservePreviousGeneration`) in the Projects directory forever. No startup sweep exists. Litter only — the rename-commit design means the target/`.bak` pair is never torn — but on a flaky machine this accumulates and pollutes the library folder (they don't match `hasProjectFileExtension`, so they're just invisible garbage).

### L2 — Cancel-path orphans in the recorder
`src/hooks/useScreenRecorder.ts:2225-2240` (native cancel), `:1040-1086` (webcam onstop), `:1432-1438` (recovery-failure webcam delete)

- Native cancel: `stopNativeScreenRecording()` finalizes the mp4, then `deleteRecordingFile` removes it. If stop returns no path on failure (`:2232-2235` guard), a partial mp4 is orphaned; a crash between stop and delete orphans the whole canceled take with sidecars. No cleanup sweep.
- Webcam store race: `cancelRecording` sets `webcamDiscardRequested` and nulls `pendingWebcamPathPromise` (`:2207-2220`), but if `onstop` had already passed the discard check (`:1046`) and is inside `storeRecordedVideo`, the file is still written and resolved into a promise nobody awaits — an orphaned `-webcam` file with no deletion.
- Recovery-failure path deletes the saved webcam via `deleteRecordingFile(webcamPath)` (`:1436`) — correct guard-wise, but note it does not clear a session manifest if one referenced it.

### L3 — Session-level `hideOverlayCursorByDefault` is not persisted in the manifest
`electron/ipc/project/session.ts:34-39` (manifest fields: version, file names, offset only)

The in-memory session carries `hideOverlayCursorByDefault` (`register/project.ts:644-651`) but the v2 manifest has no field for it. After a restart, re-resolving the same recording via manifest loses the preference. Minor preference loss, but the manifest is the designated crash-recovery record.

### L4 — `set-current-video-path` cannot clear an existing webcam manifest link
`electron/ipc/register/project.ts:657-659` vs `:701`

It persists the manifest only when `nextSession.webcamPath` is truthy, and it resolves the session *from* the manifest first (`:638`) — so once a webcam link exists, this channel can never break it; only `set-current-recording-session` (explicit `webcamPath: null` → `fs.rm` in `session.ts:30`) can. Asymmetric cleanup; benign today because renderer flows use the right channel, but a trap.

### L5 — Deleting the linked webcam file leaves the current session stale
`electron/ipc/register/project.ts:806-812`

State is cleared only when the deleted path equals `currentVideoPath`. Deleting the currently-linked `-webcam` file directly leaves `currentRecordingSession` pointing at a missing file until the next resolve (which degrades gracefully to `webcamPath: null` via the existence check at `session.ts:75-78`, but leaves the manifest on disk).

### L6 — Windows path edge cases in project naming and comparison
`electron/ipc/register/project.ts:59-83`; `electron/ipc/utils.ts:27-29`

- `normalizeProjectSaveName` strips invalid characters and trailing dots/spaces but not **reserved device names** (`CON`, `NUL`, `COM1`…). `save-project-file-named` with name `NUL` targets `Projects\NUL.morec`; the final `fs.rename` onto the device fails with a cryptic error (no data loss — atomicSave fails closed — but a confusing failure).
- No length guard: a long name under a deep custom recordings dir can exceed MAX_PATH (Electron does not declare long-path awareness); atomicSave's ~45-char temp suffix pushes marginal names over the edge. Fails with ENAMETOOLONG/ENOENT, recoverable but opaque.
- `normalizePath` is `path.resolve` only: `isPathInsideDirectory` (`manager.ts:43-50`), `isTrustedProjectPath` (`:504-507`) are case-sensitive string compares while `getQueueKey` (`atomicSave.ts:22-25`) is case-insensitive — inconsistent on a case-insensitive filesystem. Both sides usually come from the OS with canonical casing (dialog/realpath), so this is a latent mismatch, not an observed bug. Spaces and Unicode in paths are handled correctly in this scope (`Array.from` respects surrogate pairs at `register/project.ts:74`; `toFileUrl` percent-encodes segments).

### L7 — Recordings themselves are stored non-atomically (adjacent to scope)
`electron/ipc/register/recording.ts:1705-1719`

`store-recorded-video` writes the final mp4/webm with one bare `fs.writeFile` at the destination name. A crash mid-store leaves a partial recording (recovery scan `get-recorded-video-path` skips invalid candidates, but the torn file persists as an unusable library entry). Included because it feeds the session lifecycle under review; fixing pattern would be the same temp+rename used by `atomicSave`.

### L8 — Recordings-settings load race at startup
`electron/ipc/utils.ts:115`

`loadRecordingsDirectorySetting` sets `recordingsDirLoaded = true` *before* awaiting the file read. Concurrent `getRecordingsDir()` callers early in startup (many handlers call it) skip the load while it's in flight and resolve the default dir. Narrow window, wrong-location writes possible for very early recordings; the flag should be set after the read resolves.

---

## Test-coverage gaps (cross-check of `project*.test.ts` + `atomicSave.test.ts`)

| Area | Covered | Missing |
|---|---|---|
| `atomicSave.test.ts` | commit w/o backup, stale-backup removal, generation preservation, backup-commit failure, write serialization, mode bits | No fault injection around the rename windows; no unicode/space/long project paths; no stale-`.tmp` sweep test (feature absent); no `.bak`-on-load fallback test (feature absent); queue-key case-collision behavior untested |
| `manager.recents.test.ts` | empty load, dedupe/extension filter, MAX cap, listing union, unreadable recents kept | No torn/corrupt recents-file test (M2 reset path); no concurrency test (M3); **the listing test never exceeds the mocked MAX cap, hiding M1** |
| `manager.test.ts` | media policy, BOM, invalid payloads, audio approval, thumbnail preserve | No `persistRecordingsDirectorySetting` corruption/reset test; no corrupt-project-file load test (M6 surface); no save-handler tests |
| `register/project.test.ts` | `delete-recording-file` only (sidecars, traversal, symlinks, idempotency, prefix dirs) | **`save-project-file`, `save-project-file-named` (rename/overwrite/recent-filter logic), `load-project-file`, `set-current-*` have zero coverage.** Delete tests don't cover the locked-file/EBUSY path (H1), crash ordering, or unicode paths |
| `session.ts` | — | **No test file at all**: manifest persist/resolve, torn-manifest behavior (M4), offset recovery, `webcamFileName` traversal (M5), `-webcam` fallback |
| `projectPersistence.test.ts` | region/editor normalization | No `toFileUrl`/`fromFileUrl` round-trip tests (drive/UNC/Unicode/space), no `validateProjectData` tests |

---

## What already works well (for calibration)

- `atomicSave.ts` commit ordering is correct: fsync'd `wx` temp → copy previous generation to fsync'd backup tmp → atomic same-volume rename → best-effort dir sync (correctly skipped on win32). A crash at any point leaves either the old or the new complete generation — no torn project file.
- `listProjectLibraryEntries` deliberately never prunes recents that are temporarily unreadable (`manager.ts:398-403`) — the union design is right; only the slice cap defeats it (M1).
- The delete sidecar suffix list is a superset of every sidecar suffix the current recorder creates (verified `.mic.wav`, `.system.wav`, `.mic.webm`, `.mic.source.webm(.tmp)`, diagnostics, cursor/telemetry, manifest, `-webcam*` prefix scan).
- `register/project.test.ts` delete-handler tests are unusually thorough on traversal/symlink/prefix-sibling defenses.
- Single-instance lock is enforced in packaged builds (`electron/main.ts:192-199`), which closes the two-app-instance write race in production (dev-only exposure remains).

---

## Suggested fix order (when approved)

1. **H1** — delete handler: attempt main unlink first; if it fails with anything other than ENOENT, abort before touching sidecars and return the error.
2. **M2 + M4** — route recents, recordings-settings, session manifest (and L7 store) through `writeProjectFileAtomically` (or a shared temp+rename helper); cheap, mechanical.
3. **M1** — cap recents by recency order, or exempt recents-only paths from the listing rewrite.
4. **M6** — load-time `.bak` fallback (try main, on parse failure try `.bak`, surface which was used).
5. **M5** — validate `webcamFileName` is a plain basename before join.
6. **M7, L1-L8** — as capacity allows; L1 sweep pairs naturally with M2.
