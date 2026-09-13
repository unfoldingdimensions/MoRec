# Video Editor UI/UX Review — 2026-09-13

**Scope:** `src/components/video-editor/` — PlaybackControls, CaptionListPanel, ExportSettingsMenu, AnnotationSettingsPanel, ExtensionManager, SettingsPanel, CropControl, editorHistory.ts, editorPreferences.ts, projectDirtyState.ts, projectPersistence.ts, captionOps/captionEditing/captionLayout, exportDimensions/exportStatusModel/exportStartSettings, plus the keyboard-shortcut layer (useTimelineKeyboardShortcuts, ShortcutsConfigDialog, VideoEditor window handler).

**Method:** review only, no fixes. Every finding was read in source this session; load-bearing keyboard claims were re-verified by hand. Findings are cross-checked against the existing `*.test.ts(x)` files; untested branches are listed at the end.

Severity legend: **H** = correctness/data-loss or crash users can hit; **M** = broken UX, dead controls, or misleading UI; **L** = polish, dead code, edge cases.

---

## High

### H1. Clip speed change leaves captions, audio regions, annotations, and speed regions stale
`src/components/video-editor/VideoEditor.tsx:4208-4209`, `src/components/video-editor/clipSpeedChange.ts:29-97`

`handleClipSpeedChange` applies `planClipSpeedChange`, which updates **only** `clipRegions` and `zoomRegions`. The clip's `endMs` moves (speeding up shrinks the span, slowing down grows it), but caption cues, audio regions, annotation regions, and speed regions anchored inside the old span are never retimed, shifted, or checked for overlap.

- **Expected:** all time-anchored content within/after the affected span adjusts with the clip — the trim path already does exactly this (`VideoEditor.tsx:4143-4167` shifts overlapping zooms *and captions*, `handleClipDelete` at `:4236-4257` deletes regions in the removed span). Zooms are rescaled here but captions are not, which is inconsistent within the same handler.
- **Actual:** speed a clip from 1× to 2× and every caption cued inside it now plays over the *following* clip's footage; slow a clip down into a gap and it silently overlaps whatever captions/audio were placed in that gap (no `blockedReason` toast fires for those — `planClipSpeedChange` only checks the next clip and zoom overlaps, `clipSpeedChange.ts:48-54, 78-89`).
- Also note: a zoom *straddling the clip's start boundary* is intentionally not rescaled (`clipSpeedChange.ts:58` filters `zoom.startMs >= clip.startMs` only on the inner edge); if it also extends past the new end on speed-up, its tail is silently truncated by the rescale of nothing — the region simply no longer lines up with the clip it was cut for.

`clipSpeedChange.test.ts` covers the plan math (blocked cases, zoom scaling) — there is no test anywhere for caption/audio side effects of a speed change. This is the biggest correctness gap found.

### H2. Undo/redo ignores trims — undo after a trim produces a mixed state
`src/components/video-editor/editorHistory.ts:11-22`, `src/components/video-editor/VideoEditor.tsx:1951-1970`

`EditorHistorySnapshot` contains zoom/clip/speed/annotation/audio regions and captions, but **not `trimRegions`**. `buildHistorySnapshot` (`VideoEditor.tsx:1951-1970`) mirrors that omission.

- **Expected:** undoing a trim restores the pre-trim timeline.
- **Actual:** a trim also shifts/removes overlapping zooms and captions (`VideoEditor.tsx:4143-4167`); those *are* snapshotted. Pressing Undo after a trim reverts the shifted captions/zooms back to pre-trim positions while the trim itself stays applied — captions floating over trimmed-away footage. Redo has the mirror problem.

### H3. Timeline drags flood the undo stack (100-entry cap evicts real edits)
`src/components/video-editor/VideoEditor.tsx:2356-2369`, `src/components/video-editor/timeline/hooks/useTimelineDndBindings.ts:170-189`, `src/components/video-editor/editorHistory.ts:83-87`

The history-recording effect runs on every snapshot change with no coalescing, and `handleItemSpanChange` is wired directly to dnd-timeline's `onItemSpanChange`, which fires **continuously during a drag** (every pointermove updates `zoomRegions`/`clipRegions`/etc. via `handleZoomSpanChange` at `VideoEditor.tsx:3990-4000` and siblings).

- **Expected:** one undo step per gesture (coalesce on drag end), like every mainstream editor.
- **Actual:** a single ~2-second drag of a zoom block records dozens of intermediate snapshots; `recordEditorHistorySnapshot` caps `past` at `MAX_EDITOR_HISTORY_ENTRIES = 100` by `shift()`ing the *oldest* entry (`editorHistory.ts:84-87`), so a few drags evict the user's earlier discrete edits. Undo then walks through per-frame drag positions.

### H4. Extension detail modal crashes on marketplace entries without `tags`/`permissions`
`src/components/video-editor/ExtensionManager.tsx:466` (`detail.ext.tags.length > 0`), `:377` + `:486` (`permissions.length > 0`)

The MarketplaceCard was already hardened against remote payloads missing `tags` — the guard comment at `ExtensionManager.tsx:244-246` says explicitly: "tags comes from the remote marketplace payload and may be absent on older cached entries; guard so one bad card cannot crash the panel." The detail modal renders the same data unguarded.

- **Expected:** card and modal tolerate absent `tags`/`permissions` (the `MarketplaceExtension` type at `src/lib/extensions/types.ts:179,181` claims non-optional, but the runtime contract clearly isn't — that's why the card was fixed).
- **Actual:** clicking a tag-less marketplace card to open its detail throws `TypeError: Cannot read properties of undefined (reading 'length')` and takes down the panel. Same class as the bug fixed in the previous pass; the modal was missed.
- `ExtensionManager.test.tsx` never renders the detail modal at all, so this is untested code.

### H5. Rebinding a shortcut also triggers the action it captures (Space plays/pauses while capturing)
`src/components/video-editor/ShortcutsConfigDialog.tsx:54-93` vs `src/components/video-editor/VideoEditor.tsx:4512-4570`

Both are `window` `keydown` listeners in the **capture** phase, and VideoEditor's is registered first (editor mount precedes dialog mount). `handleCapture` calls `e.stopPropagation()` (`ShortcutsConfigDialog.tsx:56`), but `stopPropagation` cannot stop other listeners attached to the *same node* — that requires `stopImmediatePropagation`.

- **Expected:** while the capture prompt is active, the pressed chord is recorded and nothing else happens.
- **Actual:** pressing **Space** to bind it toggles playback and records the binding; pressing **Ctrl/Cmd+Z** performs an undo while recording it. Escape works only by luck of ordering of the guards inside each handler.

---

## Medium

### M1. Editor preferences silently drop `zoomTemporalMotionBlur`, `zoomMotionBlurSampleCount`, `zoomMotionBlurShutterFraction`
`src/components/video-editor/editorPreferences.ts:289-360` (the `candidate` map) vs the `PersistedEditorControls` type at `:11-64` which includes all three; saved from `VideoEditor.tsx:2629-2631`.

`normalizeEditorControls` never copies these three fields from `sanitizedRaw` into `candidate`, so `normalizeProjectEditor` re-derives them from defaults on every load/save round-trip — despite the type declaring them persisted and `VideoEditor` explicitly passing them to `saveEditorPreferences`. Note `stripPersistedDevMotionBlurSettings` (`projectPersistence.ts:188-194`) strips only `zoomMotionBlurTuning`, i.e. the other three are *not* intentionally stripped. The same drop applies to editor presets: `serializeEditorPresetSnapshot` → `normalizeEditorPresetSnapshot` → the same map (`editorPreferences.ts:280-282, 216`), so presets also cannot store these values, and the preset "active" signature comparison can't distinguish states that differ only in them. `editorPreferences.test.ts:240` ("saves all editor controls") does not assert these three fields, so the gap is invisible to the suite. Currently masked in practice by M2 (no UI can change them), but any project-file restore that writes preferences loses them.

### M2. Temporal-blur settings are unreachable: props passed, controls never rendered
`src/components/video-editor/SettingsPanel.tsx:789-794`; passed at `src/components/video-editor/VideoEditor.tsx:6477-6482`

`zoomTemporalMotionBlur` / `zoomMotionBlurSampleCount` / `zoomMotionBlurShutterFraction` and their `on*Change` handlers are declared props of `SettingsPanel`, and VideoEditor wires the live state setters — but neither the value nor the handler is referenced anywhere in the ~4,400-line panel body (the sole occurrence of `zoomTemporalMotionBlur` is the prop declaration). The dev-only info box (`SettingsPanel.tsx:3480-3491`) displays hardcoded `TEMPORAL_MOTION_BLUR_DEFAULT_*` constants regardless of actual state.

- **Expected:** either rendered controls or no prop wiring.
- **Actual:** dead wiring; the state can only change via project-file load (`VideoEditor.tsx:2078-2080`) or preset application (which per M1 normalizes them back to defaults). Values still reach the exporters (`VideoEditor.tsx:4682, 4866`), so exported output can depend on settings the UI cannot display or change.

### M3. "Zoom Timeline — Ctrl+Scroll" is documented but not implemented
`src/lib/shortcuts.ts:44` (`FIXED_SHORTCUTS`), rendered in `src/components/video-editor/ShortcutsConfigDialog.tsx:219-231` and `src/components/video-editor/TutorialHelp.tsx:254-261`

The sole timeline wheel handler (`useTimelineRange.ts:77-112`, wired at `TimelineEditor.tsx:441`) **early-returns on ctrl/meta+scroll** (`:79`) and never zooms; the chord falls through to Electron's application zoom (`electron/main.ts:476-478` zoomIn/zoomOut roles). Shift+Scroll pan *is* implemented.

- **Expected:** the shortcut list matches behavior.
- **Actual:** the list promises a timeline zoom that doesn't exist; users pressing Ctrl+Scroll zoom the entire app window instead.

### M4. Custom bindings can collide with hardcoded undo/redo/select-all
`src/components/video-editor/VideoEditor.tsx:4519-4540` (hardcoded Ctrl/Cmd+Z, Shift+Z, Ctrl+Y), `src/components/video-editor/timeline/hooks/useTimelineKeyboardShortcuts.ts:75-82` (hardcoded Ctrl/Cmd+A); conflict detection `src/lib/shortcuts.ts:60-76` knows only configurable + fixed entries.

- **Expected:** rebinding an action to a reserved chord either rebinds undo or is rejected as a conflict (the dialog already has that UX for `fixed` shortcuts, `ShortcutsConfigDialog.tsx:75-82`).
- **Actual:** bind any action to Ctrl+Z and both fire (undo + the action). Bind one to Ctrl+A: with zoom blocks present the hardcoded select-all wins and the action is unreachable; with none present the early return (`useTimelineKeyboardShortcuts.ts:76-78`) swallows the chord without `preventDefault`, so the browser selects all page text. Bonus: the add/split bound actions (`:84-89`) never call `preventDefault`, so default behavior for exotic bindings can leak through.

### M5. Captured binding fires on a different physical chord (modifier asymmetry)
`src/components/video-editor/ShortcutsConfigDialog.tsx:67` records `ctrl: true` for **either** Ctrl or Cmd (`e.ctrlKey || e.metaKey`); `matchesShortcut` (`src/lib/shortcuts.ts:103-104`) tests only the platform-primary modifier.

- **Expected:** the chord you press is the chord that fires.
- **Actual:** on macOS, capturing with the **Ctrl** key produces a binding that fires on **Cmd**+key; on Windows, capturing with the **Win** key fires on **Ctrl**+key. (`formatBinding` renders `ctrl` as ⌘ on Mac, so the dialog even *displays* the swapped chord, consistently.)

### M6. Split button is enabled for single-word cues and silently does nothing
`src/components/video-editor/CaptionListPanel.tsx:173-183`; `src/components/video-editor/captionOps.ts:138-140`

`splitCue` returns cues unchanged when the cue has fewer than two words (`captionOps.ts:138-140`, pinned by `captionOps.test.ts:110`), but the panel always renders Split enabled.

- **Expected:** the button is disabled (like Merge is for the last cue, `CaptionListPanel.tsx:186`) or shows feedback.
- **Actual:** single-word cues are common in auto-caption output; clicking Split on one is a silent no-op. No UI-level test covers this case.

### M7. Multi-cue caption edits can emit empty-text cues that vanish on next load
`src/components/video-editor/captionEditing.ts:161-183` + `src/components/video-editor/projectPersistence.ts:715`

`updateCaptionCuesForEditedTarget` distributes new tokens across cue segments by duration weight. When the replacement text has fewer tokens than the number of edited cues (`tokenCount < segments.length`, `:195-204`), smaller segments receive **0 tokens**; if all of a cue's words were edit targets, `nextWords` ends up empty and the cue is rewritten with `text: ""` and no `words` (`:180-182`). On the next save/load, `normalizeProjectEditor` filters out cues with empty text (`projectPersistence.ts:715`) — the cue silently disappears.

- **Expected:** either the cue keeps placeholder content or the operation is rejected/confirmed.
- **Actual:** caption lost after a save/reload cycle, with no in-session signal.

### M8. Global Tab swallowing blocks keyboard navigation app-wide
`src/components/video-editor/VideoEditor.tsx:4542-4548`

The window capture handler `preventDefault()`s Tab for every non-editable target, unconditionally — not just when the timeline annotation-cycle needs it (`useTimelineKeyboardShortcuts.ts:91-95` only cycles when annotations exist, and would `preventDefault` itself on success).

- **Expected:** Tab moves focus through buttons/controls; the timeline intercepts it only for its own cycle.
- **Actual:** keyboard-only users cannot tab past the editor's non-input controls at all. (Accessibility regression; the timeline cycle is a strict subset of what's blocked.)

---

## Low

### L1. Caption text cannot be cleared — silently reverts
`src/components/video-editor/CaptionListPanel.tsx:87-92`; `src/components/video-editor/captionEditing.ts:118-121` (pinned as intended by `captionEditing.test.ts:112`). Deleting all text and blurring restores the old text with no message. Fine as a policy, but there is no feedback and no alternative way to blank a cue short of deleting it.

### L2. Final caption can snap off without its exit fade when cue end overshoots the last word
`src/components/video-editor/captionLayout.ts:315-324` (last page ends at the last word's end), `:499-502` (layout returns null past page end), `:535-538` (`willDisappear` is false because `isWithinCaptionCoverage` is still true inside `cue.endMs`). When a cue's `endMs` extends beyond its last word's `endMs` — typical for whisper-generated cues — `exitAnchorMs` stays pinned and the fade-to-0 path (`:549`) is unreachable; the caption disappears abruptly one frame past the last word. The long comment at `:522-538` describes exactly the fade this code then fails to reach in this case.

### L3. Dead expression in `flattenCaptionWords`
`src/components/video-editor/captionLayout.ts:190-195`. `startsMergedCue` requires `!shouldForceCueBreak` (first cue only), but `leadingSpace` for it also requires `flattened.length > 0`, which is false for the first cue. The conjunction is always false; the abandoned "merge first word with previous line" behavior is unreachable dead code (current cue-break behavior is correct).

### L4. AnnotationSettingsPanel: dead `onDelete` prop; bold/italic/underline state can desync
`src/components/video-editor/AnnotationSettingsPanel.tsx:45` declares `onDelete?: () => void` — never destructured (`:61-69`) or rendered; deletion happens elsewhere (timeline Delete key). The formatting toggles (`:309-374`) drive Radix `ToggleGroup` purely through `onClick` + manual `data-state` overrides on an **uncontrolled** group: an annotation loaded with `fontWeight: "bold"` shows Radix's internal off-state (or a conflicting duplicate attribute, depending on which wins), and the first click flips the actual style while the button state moves oppositely — button lit, text un-bold. `AnnotationSettingsPanel.test.tsx` covers text/type/upload paths only; no toggle-state test exists.

### L5. Crop region cannot be moved as a whole
`src/components/video-editor/CropControl.tsx:69-143` offers only four edge-resize handles; the interior is not draggable, and the SettingsPanel crop section has side-based resize plus a reset (`SettingsPanel.tsx:1985-1986, 2663`) but no move. Repositioning requires shrinking and re-growing from opposite edges.

### L6. `zoomSmoothness` is a dead field end-to-end
`normalizeProjectEditor` always forces `DEFAULT_ZOOM_SMOOTHNESS` (`projectPersistence.ts:913`); the VideoEditor state (`VideoEditor.tsx:510`) has a setter only reachable from project load (`:2106`), which always yields the default; no UI writes it. `VideoPlayback` consumes it (`VideoPlayback.tsx:461`), so the prop chain is live but the value is permanently 0.5.

### L7. Marketplace install failures without a result object show nothing
`src/components/video-editor/ExtensionManager.tsx:749-782`. Only `result.success === false` toasts; if `marketplaceInstall` **throws** (IPC/network), `finally` clears the spinner but no toast appears and the rejection is unhandled. `ExtensionManager.test.tsx:169` covers only the failure-result path.

### L8. PlaybackControls polish
`src/components/video-editor/PlaybackControls.tsx:26-31` — `formatTime` has no hours tier (a 75-minute recording shows `75:30`, inconsistent with a `h:mm:ss` expectation). `:80` — seek slider `max={duration || 100}` silently permits seeks into an unknown-duration video before metadata loads.

### L9. Timeline shortcuts stay live behind the non-modal ProjectBrowserDialog
`src/components/video-editor/ProjectBrowserDialog.tsx:129-141` handles only Escape and doesn't take focus; with the timeline still focused, Z/C/F/A/Delete keep mutating the timeline behind the open dialog. The editable-target guard in the shortcuts hook covers only inputs.

---

## Dirty-state assessment (no loss bugs found in the guard paths, two design notes)

- Close-with-unsaved-changes is handled via IPC (`onRequestSaveBeforeClose` → silent save with `autoSaveDefaultNameIfUnset: true`, `VideoEditor.tsx:3132-3141`), not `beforeunload`. Behavior: the app **auto-saves an unnamed project under a default name on window close** rather than prompting. Intentional (`autoSaveDefaultNameIfUnset`), but surprising — a user who never chose a project name finds a new file in their library after closing.
- Autosave runs only when a project path exists (`VideoEditor.tsx:3154-3168`, `PROJECT_AUTOSAVE_DELAY_MS = 1000` at `:361`). A fresh, never-saved recording has `hasUnsavedChanges: true` from the first edit but no autosave; only a clean close saves it. A crash loses the entire session. Consider periodic snapshot-to-temp for unnamed sessions.
- The dirty flag itself is sound: `currentPersistedEditorState` is a synchronous complete memo (`VideoEditor.tsx:1814-1881`), both sides of the comparison pass through the same `stripPersistedDevMotionBlurSettings`, and `hasUnsavedProjectChanges` semantics (including the null-current case) are pinned by `projectDirtyState.test.ts`. Replace-source flows ("open another project", "import a file") all route through `confirmReplaceSourceWithUnsavedChanges` (`VideoEditor.tsx:3248-3266`).

## Checked and found sound

`exportDimensions.ts`, `exportStatusModel.ts`, `exportStartSettings.ts` (well covered by tests, math verified); `editorHistory` core push/pop/clone/cap logic; `PlaybackControls` seek/volume/label behavior; `mp4OutputDimensions` completeness at the call site (`VideoEditor.tsx:1514-1534`); GIF preset label ternary (`GifSizePreset` has exactly three keys, `types.ts:184`); CUDA opt-in gating (`useNvidiaCudaExportOptIn.ts`); annotation type-switch content preservation via `textContent`/`imageContent` slots (`VideoEditor.tsx:4415-4431`); `toFileUrl`/`fromFileUrl` round-trips including UNC and Windows drive paths; custom-whisper-path storage.

## Test-coverage gaps (branches this review flagged that no test exercises)

| Finding / area | File | Gap |
|---|---|---|
| H1 | `clipSpeedChange.test.ts` | Plan-level unit tests only; nothing asserts caption/audio/annotation behavior after a speed change |
| H2 | `editorHistory.test.ts` | Snapshot shape not asserted to include every mutable timeline region; no trim+undo test |
| H3 | `editorHistory.test.ts` | Cap test exists; no coalescing test (none possible at unit level — component-level gap) |
| H4 | `ExtensionManager.test.tsx` | Detail modal never rendered in tests — the unguarded `tags`/`permissions` reads are untested |
| M1 | `editorPreferences.test.ts:240` | "saves all editor controls" omits the three temporal-blur fields from its assertions |
| M4/M5 | `useTimelineKeyboardShortcuts.test.tsx` | No test for conflicts with hardcoded undo/select-all; no modifier-capture asymmetry test |
| M6 | `CaptionListPanel.test.tsx` | Split tested only for the multi-word happy path; no single-word no-op case; `parseTimecode` accepts seconds > 59 (`CaptionListPanel.tsx:32-41`) untested |
| L2/L3 | `captionLayout.test.ts` | **One test** for a 583-line module — page building, word states, animation/exit anchoring, and the line-breaking DP are all untested |
| L4 | `AnnotationSettingsPanel.test.tsx` | No bold/italic/underline state tests |
| — | `projectPersistence.test.ts` | No coverage for the `audioRegions` / `autoCaptions` word-clamping / `clipRegions` / `speedRegions` preset / webcam normalization blocks (~300 lines) |
