# MoRec Pre-Launch Audit â€” Dead Code, Unused Assets & Code Duplication Report
- **Audit Date**: 2026-08-20
- **Auditor**: Teamwork Explorer (Dead Code, Unused Assets & Code Duplication Auditor)
- **Status**: Complete & Verified
- **Target Repository**: MoRec Desktop Application (`unfoldingdimensions/MoRec`)
- **Total Code Files Scanned**: 417 files (TypeScript, TSX, CJS, MJS, SVG, JSON5, CSS)
- **Total Exports Analyzed**: 1,457 exports across renderer & main process

---

## Executive Summary

| Category | Finding Count | Key Impact | Potential Savings / Benefit |
|---|:---:|---|---|
| **Unused Components & Views** | 10 | Obsolete UI wrappers, superseded dialogs, dead timeline toolbar | ~800+ lines of dead JSX/TSX removed |
| **Dead Files & Functions** | 18 | Abandoned routing plans, uncalled legacy canvas renderer, dead helpers | ~1,500+ lines of uncalled dead code removed |
| **Dead IPC Channels & Preload Wrappers** | 15 | Phantom Electron APIs (e.g. `getLinuxWindowSystem`), uncalled project/recording handlers | Cleaner security boundary, zero IPC clutter |
| **Code Duplication & Redundant Logic** | 8 clusters | Duplicated `clamp` (8x), `clamp01` (7x), `formatTime` (4x), FFmpeg helpers (3x) | Single source of truth, reduced maintenance overhead |
| **Orphaned Assets & Asset Bloat** | 82 assets | 14 unindexed wallpapers (19.77 MB), 66 unused cursor SVGs, Vite/React template leftovers | **~20 MB reduction** in packaged installer & bundle sizes |
| **Dependency & Config Bloat** | 7 | Unused packages (`emoji-picker-react`, @radix-ui/react-accordion`), `react-icons` 6-package prebundle | Faster build times, smaller `node_modules` and vendor bundle |

---

## Detailed Findings

### Category 1: Unused Components & Views

#### [DEAD-001] Complete Unused UI Component Set (`accordion.tsx`, `card.tsx`, `content-clamp.tsx`, `item-content.tsx`)
- **Severity**: Medium
- **Location**:
  - `src/components/ui/accordion.tsx` (56 lines)
  - `src/components/ui/card.tsx` (56 lines)
  - `src/components/ui/content-clamp.tsx` (113 lines)
  - `src/components/ui/item-content.tsx` (19 lines)
- **Proof**: AST and regex search across all 417 code files returns **0 imports** for all 4 components.
- **Context & Recommendation**: These are uncalled shadcn/ui components copied during early scaffolding. Safe to delete immediately along with `_radix-ui/react-accordion` and its Tailwind keyframes.

---

#### [DEAD-002] Superseded Export & Shortcut Dialog Components (`FormatSelector.tsx`, `GifOptionsPanel.tsx`, `KeyboardShortcutsHelp.tsx`)
- **Severity**: Medium
- **Location**:
  - `src/components/video-editor/FormatSelector.tsx` (83 lines)
  - `src/components/video-editor/GifOptionsPanel.tsx` (121 lines)
  - `src/components/video-editor/KeyboardShortcutsHelp.tsx` (84 lines)
- **Proof**: 0 imports repo-wide. `FormatSelector` and `GifOptionsPanel` were superseded by inline format and preset controls in `ExportSettingsMenu.tsx`, while `KeyboardShortcutsMelp` was superseded by `ShortcutsConfigDialog.tsx` and `TutorialHelp.tsx`.
- **Recommendation**: Delete all 3 orphaned component files (288 lines).

---

#### [DEAD-003] Standalone Abandoned `TimelineToolbar.tsx`
- **Severity**: Medium
- **Location**: `src/components/video-editor/timeline/components/toolbar/TimelineToolbar.tsx` (236 lines)
- **Proof**: 0 imports across the entire repository. The timeline in `TimelineEditor.tsx`, `VIdeoEditor.tsx`, and `TimelineWrapper.tsx` renders header controls and shortcut bindings directly.
- **Recommendation**: Delete `TimelineToolbar.tsx` (236 lines).

---

#### [DEAD-004] Abandoned Barrel Index Files
- **Severity**: Low
- **Location**:
  - `src/components/video-editor/index.ts` (10 lines)
  - `src/components/video-editor/videoPlayback/index.ts` (9 lines)
- **Proof**: 0 files import from @/components/video-editor or @/components/video-editor/videoPlayback. All consumers import directly from target modules.
- **Recommendation**: Delete both barrel files to eliminate dead re-exports.

---

### Category 2: Dead Files, Functions & Obsolete Types

#### [DEAD-005] Entire Orphaned Module: `src/lib/exporter/nativeFrameCapture.ts`
- **Severity**: Medium
- **Location**: `src/lib/exporter/nativeFrameCapture.ts` (119 lines)
- **Proof**: `captureCanvasFrameForNativeExport`, `getFallbackReadbackContext`, `captureCanvasFrameWithReadback`, and `flipRgbaRowsInPlace` have 0 callers across the repository.
- **Recommendation**: Delete `nativeFrameCapture.ts` (119 lines).

---

#### [DEAD-006] Dead Legacy 2D Canvas Cursor Renderer `drawCursorOnCanvas`
- **Severity**: Low
- **Location**: `src/components/video-editor/videoPlayback/cursorRenderer.ts` (Lines 1624â€“1701, 78 lines)
- **Proof**: MoRec migrated playback and export to Pixi.js / WebGL / Native C++ compositor pipelines (`PixiCursorRenderer`, `ModernFrameRenderer`). `drawCursorOnCanvas` has 0 callers.
- **Recommendation**: Delete `drawCursorOnCanvas` function from `cursorRenderer.ts`.

---

#### [DEAD-007] Orphaned Route Planning File: `electron/ipc/export/nativeStaticLayoutRoutePlan.ts`
- **Severity**: Medium
- **Location**: `electron/ipc/export/nativeStaticLayoutRoutePlan.ts` (133 lines)
- **Proon**: 0 production files import `nativeStaticLayoutRoutePlan.ts`. It is only referenced by its self-contained unit test `nativeStaticLayoutRoutePlan.test.ts`. The actual routing logic was duplicated and embedded directly into `electron/ipc/export/native-video.ts`.
- **Recommendation**: Either integrate `planNativeStaticLayoutRoutes` into `native-video.ts` or remove the redundant test-only file and its duplicate test.

---

#### [DEAD-008] Dead Utility Functions in Active Modules
- **Severity**: Low
- **Location**:
  1. `src/lib/customFonts.ts:68` â€” `removeCustomFont`: 0 callers repo-wide.
  2. `src/utils/platformUtils.ts:53,60` â€” `getModifierKey`, `getShiftKey`: 0 callers repo-wide (app uses `shortcuts.ts` instead).
  3. `src/components/video-editor/videoPlayback/mathUtils.ts:65,75,85` â€” `smoothStep`, `easeInOutCubic`, `easeOutCubic`: 0 callers repo-wide.
  4. `src/components/video-editor/timeline/zoomSuggestionUtils.ts:173,252` â€” `detectZoomDwellCandidates`, `detectInteractionCandidates`: 0 external callers (only called internally). Unnecessary `export`.
  5. `src/components/video-editor/AnnotationSettingsPanel.tsx:29,44` â€” `GONT_FAMILY_VALUES`, `FONT_SIZES`: Unused `export` keywords.
  6. `src/components/video-editor/ArrowSvgs.tsx:99,120,141,162` â€” `ArrowUpRight`, `ArrowUpLeft`, `ArrowDownRight`, `ArrowDownLeft`: Direct named exports have 0 external callers (only accessed via `getArrowComponent`).
- **Recommendation**: Remove unused functions and remove unnecessary `export` modifiers.

---

#### [DEAD-009] Obsolete Legacy Types and Re-Exports
- **Severity**: Low
- **Location**:
  1. `src/lib/extensions/types.ts:98,105` â€” `RecordlyExtensionAPI`, `RecordlyExtensionModule`: Legacy pre-rebrand type aliases with 0 usages.
  2. `src/lib/shortcuts.ts:22,51` â€” `FixedShortcut`, `bindingsEqual`: 0 external imports.
  3. `src/lib/wallpapers.ts:39,40` â€” `WALLPAPER_PATHS`, `WALLPAPER_RELATIVE_PATHS`: 0 external imports.
  4. `electron/updater.ts:25,27,34,42` â€” `UPDATE_REMINDER_DELAY_MS`, `UpdateToastPhase`, `UpdateStatusKind`, `isAutoUpdateFeatureEnabled`: 0 external imports.
- **Recommendation**: Remove obsolete legacy types and unexported unused constants.

---

### Category 3: Dead IPC Channels & Preload Wrappers

#### [DEAD-010] Phantom Preload Wrapper: `electronAPI.getLinuxWindowSystem`
- **Severity**: High (Defect / Dead API)
- **Location**:
  - `electron/preload.ts:910`
  - `electron/electron-env.d.ts:837`
- **Observation**: `preload.ts` exposes `getLinuxWindowSystem: () => ipcRenderer.invoke("get-linux-window-system")`. However:
  1. There is **NO `ipcMain.handle("get-linux-window-system")`** anywhere in `electron/`!
  2. There is **0 renderer calls** across `src/`.
  3. If called, it would have thrown an unhandled IPC channel error in Electron.
- **Recommendation**: Remove `getLinuxWindowSystem` from `preload.ts` and `electron-env.d.ts`.

---

#### [DEAD-011] Uncalled IOC Handlers & Preload Bridges (14 Endpoints)
- **Severity**: Medium
- **Location**: `electron/preload.ts`, `electron/electron-env.d.ts`, and `electron/ipc/register/`

| ipcMain Channel | Preload Method | Main Process Handler | Status / Why Dead |
|---|---|---|---|
| `get-recorded-video-path` | `electronAPI.getRecordedVideoPath` | `electron/ipc/register/recording.ts:251` | 0 renderer calls (app uses `getCurrentRecordingSession`) |
| `get-system-cursor-assets` | `electronAPI.getSystemCursorAssets` | `electron/ipc/register/assets.ts:167` | 0 renderer calls (app uses bundled SVG/atlas assets) |
| `clear-current-video-path` | `electronAPI.clearCurrentVideoPath` | `electron/ipc/register/project.ts:208` | 0 renderer calls |
| `load-project-file` | `electronAPI.loadProjectFile` | `electron/ipc/register/project.ts:257` | 0 renderer calls (app uses `loadCurrentProjectFile`) |
| `get-projects-directory` | `electronAPI.getProjectsDirectory` | `electron/ipc/register/project.ts:285` | 0 renderer calls |
| `open-projects-directory` | `electronAPI.openProjectsDirectory` | `electron/ipc/register/project.ts:290` | 0 renderer calls |
| skip-update-version` | `electronAPI.skipUpdateVersion` | `electron/updater.ts:326` | 0 renderer calls |
| `get-update-status-summary` | `electronAPI.getUpdateStatusSummary` | `electron/updater.ts:342` | 0 renderer calls |
| `open-recordings-folder` | `electronAPI.openRecordingsFolder` | `electron/ipc/register/recording.ts:257` | 0 renderer calls |
| `extensions:list` | `electronAPI.extensionsList` | `electron/extensions/extensionIpc.ts:40` | 0 renderer calls (app uses `extensions:discover`) |
| `extensions:get-directory` | `electronAPI.extensionsGetDirectory` | `electron/extensions/extensionIpc.ts:76` | 0 renderer calls |
| `extensions:marketplace-submit` | `electronAPI.extensionsMarketplaceSubmit` | `electron/extensions/extensionIpc.ts:159` | 0 UI calls (`useExtensions.ts:241` unused hook method) |
| h^[œÚ[ÛœÎœ™]šY]ÜË[\Ý[XÝ›ÛTK™^[œÚ[ÛœÔ™]šY]ÜÓ\Ý[XÝ›Û‹Ù^[œÚ[ÛœËÙ^[œÚ[Û’\ËÎŒMÍXZHØ[È
\ÙQ^[œÚ[ÛœËÎŒ[\ÙYÛÚÈY]Ù
HŸ^[œÚ[ÛœÎœ™]šY]Ë]\]X[XÝ›ÛTK™^[œÚ[ÛœÔ™]šY]Õ\]X[XÝ›Û‹Ù^[œÚ[ÛœËÙ^[œÚ[Û’\ËÎŒNL˜ZHØ[È
\ÙQ^[œÚ[ÛœËÎŒŽX[\ÙYÛÚÈY]Ù
H‚‹H
Š”™XÛÛ[Y[™][ÛŠŠŽˆ[™HXYSÐÈÚ[›™[Ë™[[Ý™HZ\ˆ[™\œÈ[ˆ[XÝ›Û‹Ú\ËÜ™YÚ\Ý\‹Ø[˜š[™[Hœ›ÛH[XÝ›Û‹Ü™[ØYØ[™™[[Ý™HH[\ÙYØ[˜XÚÈÜ˜\\œÈ[ˆÜ˜ËÚÛÚÜËÝ\ÙQ^[œÚ[ÛœËØ‚‚‹KKB‚ˆÈÈÈØ]YÛÜžH	ˆNˆÛÙH\XØ][Ûˆ	ˆ™Y[™[ÙÚXÂ‚ŒÈÈÈÈÑTLWH\˜\Ú]™HÛ[\	ˆÛ[\X\XØ][Ûˆ
MH\XØ]H[\[Y[][ÛœÊB‹H
Š”Ù]™\š]JŠŽˆÝÈÈXZ[[˜[˜ÙB‹H
Š“ØœÙ\˜][ÛŠŠŽ‚ˆKˆÛ[\
˜[YKZ[‹X^
X\ÈYš[™YÙ[˜[H[ˆÜ˜ËÛX‹Ý][ËÎŽ][™\[™[H™KZ[\[Y[Y[ˆ
ŠŽÝ\ˆš[\ÊŠŽ‚ˆHÜ˜ËØÛÛ\Û™[ËÝšY[ËYY]Ü‹ÐØ\[Û“\Ý[™[ÞŒŒ
Û[\[X™\˜
BˆHÜ˜ËØÛÛ\Û™[ËÝšY[ËYY]Ü‹ÝšY[Ô^X˜XÚËØÝ\œÛÜ“ÛÜ[[Y]žKÎŽˆHÜ˜ËØÛÛ\Û™[ËÝšY[ËYY]Ü‹ÝšY[Ô^X˜XÚËØÝ\œÛÜ”™[™\™\‹ÎŒÍ˜ˆHÜ˜ËØÛÛ\Û™[ËÝšY[ËYY]Ü‹ÝšY[Ô^X˜XÚËØÝ\œÛÜ”ÝØ^KÎŽXˆHÜ˜ËØÛÛ\Û™[ËÝšY[ËYY]Ü‹ÝšY[Ô^X˜XÚËÙ›ØÝ\Õ][ËÎŽˆHÜ˜ËØÛÛ\Û™[ËÝšY[ËYY]Ü‹ÝšY[Ô^X˜XÚËÞ›ÛÛU˜[œÙ›Ü›KÎŒMØˆH[XÝ›Û‹ÚYÝ™\›^P›Ý[™ËÎŒL˜ˆH[XÝ›Û‹Ú\ËØÝ\œÛÜ‹Ý[[Y]žKÎŒŽˆ‹ˆÛ[\JŠX\ÝÚ[™ÈX]›Z[ŠKX]›X^
ŠJX\È™KZ[\[Y[Y[ˆ
ŠÈÝ\ˆš[\ÊŠŽ‚ˆHÜ˜ËØÛÛ\Û™[ËÝšY[ËYY]Ü‹ØØ\[Û“^[Ý]ÎŽˆHÜ˜ËØÛÛ\Û™[ËÝšY[ËYY]Ü‹ÝšY[Ô^X˜XÚËÛX]][ËÎŒXˆHÜ˜ËÛX‹Ù^Ü\‹Û[Ù\›‘œ˜[YT™[™\™\‹ÎŒÍÍX
Û[\[š][\˜[
RˆHÜ˜ËÛX‹Ù^Ü\‹Û˜]]™TÝ]XÓ^[Ý][[Y]žKÎ
Û[\[š]
BˆHÜ˜ËÛX‹Ù^[œÚ[ÛœËØÝ\œÛÜÛÛÜ™[˜]\ËÎŒŒˆH[XÝ›Û‹Ú\ËÙ^ÜÛ˜]]™K]šY[ËÎŒMŽX
Û[\[š]
BˆH[XÝ›Û‹Ú\ËÛ˜]]™UšY[Ñ^ÜÎŒNX
Û[\[š][\˜[
R‚‹H
Š”™XÛÛ[Y[™][ÛŠŠŽˆÝ[™\™^™HÛˆÛ[\[™Û[\Xœ›ÛHÛX‹Ý][Ø
™[™\™\ŠH[™[XÝ›Û‹Ú\ËÝ][ËØ
XZ[ˆ›ØÙ\ÜÊK‚‚‹KKB‚ˆÈÈÈÈÑTL—HL	H™\˜˜][H\XØ][ÛˆÙˆ›Ü›X][YX‹H
Š”Ù]™\š]JŠŽˆÝÈÈÛ\Ú‹H
Š“ØœÙ\˜][ÛŠŠŽ‚ˆHÜ˜ËØÛÛ\Û™[ËÝšY[ËYY]Ü‹Ô^X˜XÚÐÛÛ›ÛËÞŒ¸ $ÌÌXˆHÜ˜ËØÛÛ\Û™[ËÝšY[ËYY]Ü‹Õ’Y[ÑY]Ü‹ÞÌŒ8 $ÍÌXˆ›ÝYš[™HH^XÝØ[YH[˜Ý[ÛŽ‚ˆÂˆ[˜Ý[Ûˆ›Ü›X][YJÙXÛÛ™Îˆ[X™\ŠHÂˆYˆ
Z\Ñš[š]JÙXÛÛ™ÊH\Ó˜SŠÙXÛÛ™ÊHÙXÛÛ™È
H™]\›ˆŒŒŽÂˆÛÛœÝZ[œÈHX]™›ÛÜŠÙXÛÛ™ÈÈŒ
NÂˆÛÛœÝÙXÜÈHX]™›ÛÜŠÙXÛÛ™È	HŒ
NÂˆ™]\›ˆ	ÛZ[œßN‰ÜÙXÜËÔÝš[™Ê
KœYÝ\
‹ŒŠ_XÂˆBˆˆY][Û˜[KÜ˜ËØÛÛ\Û™[ËÛ][˜ÚÚÛÚÜËÝ\ÙT™XÛÜ™[™Õ[Y\‹Î˜[™Ü˜ËØÛÛ\Û™[ËÝšY[ËYY]Ü‹ÐØ\[Û“\Ý[™[ÞŒ]™HÛYÚH]™\™Ù[[YXÛÙH›Ü›X]\œË‚‹H
Š”™XÛÛ[Y[™][ÛŠŠŽˆ^ÜHÚ[™ÛHØ[›ÛšXØ[›Ü›X]\˜][ÛŠÙXÛÛ™Îˆ[X™\‹Ü[ÛœÏÎˆÈYZ[]\ÏÎˆ›ÛÛX[ˆJX[\ˆ[ˆÜ˜ËÛX‹ÛYYXU[Z[™ËØ‚‚‹KKB‚ˆÈÈÈÈÑTL×H™Y[™[T“	ˆš[H]ÛÛ™\œÚ[Ûˆ[˜Ý[ÛœÂ‹H
Š”Ù]™\š]JŠŽˆÝÂ‹H
Š“ØœÙ\˜][ÛŠŠŽˆÑš[U\›[™œ›ÛQš[U\›ÛÛ™\œÚ[ÛœÈ\™H[\[Y[Y[™\[™[H[ˆš[\Î‚ˆHÜ˜ËØÛÛ\Û™[ËÝšY[ËYY]Ü‹Ü›Ú™XÝ\œÚ\Ý[˜ÙKÎŒŽØˆHÜ˜ËÛX‹Ø\ÜÙ]]ÎŒÌ˜ˆHÜ˜ËÛX‹Ù^Ü\‹ÛYYXT™\ÛÝ\˜ÙKÎŒLXˆHÜ˜ËÛX‹Ù^[œÚ[ÛœËÙš[U\›ËÎ‹MØ‹H
Š”™XÛÛ[Y[™][ÛŠŠŽˆÙ[˜[^™HT“Ùš[H]ÛÛ™\\œÈ[ÈÜ˜ËÛX‹Ø\ÜÙ]]Ø‚‚‹KKB‚ˆÈÈÈÈÑTLH\XØ]Y‘›\YÈ[Z[™È	ˆ\˜][Ûˆ\œÙ\œÂ‹H
Š”Ù]™\š]JŠŽˆÝÂ‹H
Š“ØœÙ\˜][ÛŠŠŽ‚ˆH›Ü›X]™›\YÔÙXÛÛ™Ê\ÊX\ÈYš[™YÈ[Y\Î‚ˆH[XÝ›Û‹Ú\ËÙ^ÜÛ˜]]™K]šY[ËÎ˜ˆH[XÝ›Û‹Ú\ËÙ™›\YËÙš[\œËÎŒMØˆH[XÝ›Û‹Ú\ËÛ˜]]™UšY[Ñ^ÜÎNL˜ˆH\œÙQ™›\YÑ\˜][Û”ÙXÛÛ™ÊÝ\œŠX\ÈYš[™YÈ[Y\Î‚ˆH[XÝ›Û‹Ú\ËÙ^ÜÛ˜]]™K]šY[ËÎŽMˆH[XÝ›Û‹Ú\ËÙ™›\YËÙš[\œËÎŒˆH[XÝ›Û‹Ú\ËÜ™XÛÜ™[™ËÙXYÛ›ÜÝXÜËÎŽL˜‹H
Š”™XÛÛ[Y[™][ÛŠŠŽˆ[Ý™H›Ü›X]™›\YÔÙXÛÛ™Ø[™\œÙQ™›\YÑ\˜][Û”ÙXÛÛ™Ø[È[XÝ›Û‹Ú\ËÙ™›\YËÙš[\œËØ[™[\ÜXÜ›ÜÜÈ˜]]™HšY[È^Ü[™XYÛ›ÜÝXÜË‚‚‹KKB‚ˆÈÈÈØ]YÛÜžHŽˆÜœ[™Y\ÜÙ]È	ˆ\ÜÙ]›Ø]‚ˆÈÈÈÈÐTÔÑULWHMÜœ[™YZ[Z[ˆØ[\\œÈ[™Y[ˆ\™[X\ÙH
ŒNKÍÈPˆ›Ø]
B‹H
Š”Ù]™\š]JŠŽˆYÚ
\ÝšX][ÛˆXÚØYÙH›Ø]
B‹H
Š“ØØ][ÛŠŠŽˆX›XËÝØ[\\œËØ‹H
Š”›ÛÙŠŠŽˆÜ˜ËÛX‹ÝØ[\\œËØ^XÚ]H[[Y\˜]\È[HXÝ]™HØ[\\œÈ[ˆ•RSÒS—ÕÐSTT”ØˆÝÙ]™\‹X›XËÝØ[\\œËØÛÛZ[œÈ
ŠŒM^˜H[XYÙHš[\ÊŠˆ]\™H™]™\ˆ™Y™\™[˜ÙY™YÚ\Ý\™YÜˆXØÙ\ÜÚX›H[ž]Ú\™H[ˆHRN‚ˆKˆX›XËÝØ[\\œËÛ[[Û˜YKšœYØ8 %
ŠKŽHPšŠ
  2. `public/wallpapers/bluerays.jpeg` â€” **3.22 MBj((€€Ì¸ÁÕ‰±¥Œ½Ý…±±Á…Á•ÉÌ½Ý…±±Á…Á•Èä¹©Á€ƒŠP€¨¨È¸ÄÈ5¨¨(€€Ð¸ÁÕ‰±¥Œ½Ý…±±Á…Á•ÉÌ½™…ÉµÙ…±±•ä¹©Á€ƒŠP€¨¨Ä¸ÜØ5	¨ ¢RâV&Æ–2÷vÆÇW'2öÇV—6FVÇ&–òæ§v(	B¢£ãsbÔ"¢ ¢bâV&Æ–2÷vÆÇW'2ö6†W''—÷æ§v(	B¢£ãrÔ"¢ ¢râV&Æ–2÷vÆÇW'2÷vÆÇW#2æ§v(	B¢£ãÔ"¢ ¢‚âV&Æ–2÷vÆÇW'2öÖ÷VçF–çG&VW2æ§v(	B¢£cƒr´"¢ ¢’âV&Æ–2÷vÆÇW'2÷vÆÇW#"æ§v(	B¢£Sc´"¢ ¢âV&Æ–2÷vÆÇW'2÷vÆÇW#ræ§v(	B¢£S3‚´"¢ ¢âV&Æ–2÷vÆÇW'2÷vÆÇW#"æ§v(	B¢£S#R´"¢ ¢"âV&Æ–2÷vÆÇW'2÷vÆÇW#æ§v(	B¢£S#´"¢ ¢2âV&Æ–2÷vÆÇW'2÷vÆÇW#æ§v(	B¢£#ƒ2´"¢ ¢BâV&Æ–2÷vÆÇW'2÷vÆÇW#Ræ§v(	B¢£#3R´"¢ ¢Ò¢¥F÷FÂ÷'†æVBvÆÇW"6—¦R¢£¢¢£’ãsrÔ&¢ ¢Ò¢¤–×7B¢£¢VÆV7G&öâÖ'V–ÆFW"æ§6öãS£3v7V6–f–W3 ¢§6öãP¢&W‡G&&W6÷W&6W2#¢°¢²&g&öÒ#¢'V&Æ–2÷vÆÇW'2"Â'Fò#¢&76WG2÷vÆÇW'2"Ð¢Ð¢ ¢WfW'’'V–ÇBDÔrÂ¦—Âå4•2–ç7FÆÆW"ÂæB–ÖvR6÷–W2ÆÂBVçW6VBf–ÆW2–çFòF†RW6W"w2&VÆV6R'VæFÆRÂFF–ærã#Ô"öbW&R&ÆöBFòF÷væÆöB6—¦W2à¢Ò¢¥&V6öÖÖVæFF–öâ¢£¢FVÆWFRÆÂBVæ–æFW†VBvÆÇW"f–ÆW2g&öÒV&Æ–2÷vÆÇW'2öà ¢ÒÒÐ ¢2222´54UBÓ%Òcb÷'†æVB7W'6÷"5dw2–â6÷W&6RG&VP¢Ò¢¥6WfW&—G’¢£¢Æ÷rò6÷W&6R‡–v–VæP¢Ò¢¤Æö6F–öâ¢£¢7&2ö76WG2ö7W'6÷'2öÖ6÷2öæB7&2ö76WG2ö7W'6÷'2÷F†öRö ¢Ò¢¥&ööb¢£¢7&2ö6ö×öæVçG2÷f–FVòÖVF—F÷"÷f–FVõÆ–&6²÷WÆöFVD7W'6÷$76WG2çG6–×÷'G2öæÇ’¢£‚7W'6÷'2¢¢f÷"Ö6÷6æB¢£‚7W'6÷'2¢¢f÷"F†öVƒbF÷FÂ’âF†R&VÖ–æ–ær¢£cb5drf–ÆW2¢¢–â7&2ö76WG2ö7W'6÷'2ö†Rærâ&V6†&ÆÂÓõóSÓSç7fvÂ6öçFW‡GVÆÖVçRÓõó#bÓ#ç7fvÂ¦ööÖ–âÓõóC2ÓC2ç7fvÂ¦ööÖ÷WBÓõóC2ÓC2ç7fvÂ&W6—¦Væ÷'F‚ÓõóSÓSç7fvÂWF2â’†fR&VfW&Væ6W27&÷72F†R&W÷6—F÷'’à¢Ò¢¥&V6öÖÖVæFF–öâ¢£¢&VÖ÷fRF†RcbVç&VfW&Væ6VB5drf–ÆW2g&öÒ7&2ö76WG2ö7W'6÷'2öFò6ÆVâWF†R76WB6÷W&6RG&VRà ¢ÒÒÐ ¢2222´54UBÓ5Ò7F'FW"66fföÆB76WBÆVgF÷fW'0¢Ò¢¥6WfW&—G’¢£¢Æ÷p¢Ò¢¤Æö6F–öâ¢£ ¢ÒV&Æ–2÷f—FRç7fv…f—FR7F'FW"–6öâ¢Ò7&2ö76WG2÷&V7Bç7fv…&V7B7F'FW"–6öâ¢Ò¢¥&ööb¢£¢&VfW&Væ6W2–â–æFW‚æ‡FÖÆÂ6÷W&6Rf–ÆW2Â÷"'V–ÆB76WG2†–æFW‚æ‡FÖÆ‚W6W2öÖ–6öç2öÖ÷&V2ÓS"çæv2ff–6öâ’à¢Ò¢¥&V6öÖÖVæFF–öâ¢£¢FVÆWFRV&Æ–2÷f—FRç7fvæB7&2ö76WG2÷&V7Bç7fvà ¢ÒÒÐ ¢2226FVv÷'’s¢FWVæFVæ7’b6öæf–r&Æö@ ¢2222´DUÓÒ6ö×ÆWFVÇ’VçW6VB–ç7FÆÆVBFWVæFVæ6–W2–â6¶vRæ§6öæp¢Ò¢¥6WfW&—G’¢£¢ÖVF—VÐ¢Ò¢¤Æö6F–öâ¢£¢6¶vRæ§6öæp¢Ò¢¥&ööâ¢£ ¢âVÖö¦’×–6¶W"×&V7F†6¶vRæ§6öã£sVÂãBãbã’(	B¢£–×÷'G2&Wò×v–FR¢¢à¢"â&V7B×&W6—¦&ÆR×æVÇ6†6¶vRæ§6öã£ƒvÂã2ããb’(	B¢£–×÷'G2&Wò×v–FR¢¢†–ç7FÆÆVB'WBæWfW"†öö¶VBW’à¢2â&F—‚×V’÷&V7BÖ66÷&F–öæ†6¶vRæ§6öã£SÂãã"ã2’(	BöæÇ’–×÷'FVB'’VçW6VB7&2ö6ö×öæVçG2÷V’ö66÷&F–öâçG7†à¢BâV—rö6öÆ÷"Ö6öçfW'F†6¶vRæ§6öã£cfÂã"ã’ã"’(	B&VGVæFçBW‡Æ–6—BFWVæFVæ7’v—F‚F—&V7B–×÷'G2‡G&ç6—F—fRFWöbV—r÷&V7BÖ6öÆ÷"Ö&Æö6¶’à¢Ò¢¥&V6öÖÖVæFF–öâ¢£¢'VâçÒVæ–ç7FÆÂVÖö¦’×–6¶W"×&V7B&V7B×&W6—¦&ÆR×æVÇ2&F—‚×V’÷&V7BÖ66÷&F–öâV—rö6öÆ÷"Ö6öçfW'Fà ¢ÒÒÐ ¢2222´DUÓ%ÒW†6W76—fR&V7BÖ–6öç6FWVæFVæ7’f÷"6–ævÆRbÔF÷B–6öà¢Ò¢¥6WfW&—G’¢£¢Æ÷rò÷F–Ö—¦F–öà¢Ò¢¤Æö6F–öâ¢£ ¢Ò6¶vRæ§6öã£ƒf†Â'&V7BÖ–6öç5Â#¢Â%ãRãRãÂ&¢Ò7&2ö6ö×öæVçG2öÆVæ6‚ôÆVæ6…v–æF÷rçG7ƒ£f†–×÷'B²'„G&t†æFÆTF÷G3"Òg&öÒÂ'&V7BÖ–6öç2÷'…Â#¶”¢Òf—FRæ6öæf–rçG3£2Ó†‡&V'VæFÆW2&V7BÖ–6öç2ö'6Â&V7BÖ–6öç2öfÂ&V7BÖ–6öç2öffÂ&V7BÖ–6öç2öf–Â&V7BÖ–6öç2öÖFÂ&V7BÖ–6öç2÷'†”¢Ò¢¥&ööb¢£¢ÆVæ6…v–æF÷rçG7†—2F†RôäÅ’Æ6R–âF†RVçF—&RCrÖf–ÆR6öFV&6RF†B–×÷'G2g&öÒ&V7BÖ–6öç6âÆÂ÷F†W"3–6öâ×&VæFW&–ær6ö×öæVçG2W6R†÷7†÷"Ö–6öç2÷&V7Fà¢Ò¢¥&V6öÖÖVæFF–öâ¢£¢&WÆ6R'„G&t†æFÆTF÷G3&v—F‚F÷G56—…fW'F–6Æg&öÒ†÷7†÷"Ö–6öç2÷&V7FÂFVÆWFRÆ–æW2>(	3‚–âf—FRæ6öæf–rçG6ÂæBçÒVæ–ç7FÆÂ&V7BÖ–6öç6à ¢ÒÒÐ ¢2222´DUÓ5ÒFVBF–Çv–æBæ–ÖF–öç2b6†F6â6†'B6öÆ÷"f&–&ÆW0¢Ò¢¥6WfW&—G’¢£¢Æ÷p¢Ò¢¤Æö6F–öâ¢£ ¢ÒF–Çv–æBæ6öæf–ræ6§3£‚ÓRÂ32Ó3BÂs‚Óƒ& ¢Ò7&2ö–æFW‚æ773£SBÓS‚Â“’Ó6 ¢Ò¢¤ö'6W'fF–öâ¢£ ¢Ò66÷&F–öâÖF÷vææB66÷&F–öâ×W¶W–g&ÖW2öæ–ÖF–öç2vW&RFFVBf÷"F†RVçW6VB66÷&F–öâçG7†à¢ÒÒÖ6†'BÓF‡&÷Vv‚ÒÖ6†'BÓV†fRW6vW27&÷72Öõ&V2à¢Ò¢¥&V6öÖÖVæFF–öâ¢£¢6ÆVâWVçW6VB¶W–g&ÖW2æB6öÆ÷"FVf–æ—F–öç2–âF–Çv–æBæ6öæf–ræ6§6æB7&2ö–æFW‚æ776à ¢ÒÒÐ ¢227F–öâÆâb&VÖVF–F–öâ&öFÖ  £â¢¥†6R¢–ÖÖVF–FR76WBbFWVæFVæ7’G&–Ò¢ ¢ÒFVÆWFRBVæ–æFW†VBvÆÇW'2–âV&Æ–2÷vÆÇW'2ö„–ç7FçFÇ’6fW2¢£’ãsrÔ"¢¢g&öÒ6¶vVBFW6·F÷&VÆV6W2’à¢ÒçÒVæ–ç7FÆÂVÖö¦’×–6¶W"×&V7B&V7B×&W6—¦&ÆR×æVÇ2&F—‚×V’÷&V7BÖ66÷&F–öâV—rö6öÆ÷"Ö6öçfW'Fà¢Ò7v'„G&t†æFÆTF÷G3&Fò†÷7†÷"F÷G56—…fW'F–6ÆÂ&VÖ÷fRf—FR&RÖ'VæFÆ–ærVçG&–W2ÂæBçÒVæ–ç7FÆÂ&V7BÖ–6öç6à¢ÒFVÆWFRV&Æ–2÷f—FRç7fvæB7&2ö76WG2÷&V7Bç7fvà £"â¢¥†6R#¢FVB6ö×öæVçBbf–ÆR&VÖ÷fÂ¢ ¢Ò&VÖ÷fRVçW6VBT’6ö×öæVçG3¢66÷&F–öâçG7†Â6&BçG7†Â6öçFVçBÖ6Æ×çG7†Â—FVÒÖ6öçFVçBçG7†à¢Ò&VÖ÷fR7WW'6VFVBVF—F÷"6ö×öæVçG3¢f÷&ÖE6VÆV7F÷"çG7†Âv–d÷F–öç5æVÂçG7†Â¶W–&ö&E6†÷'F7WG4†VÇçG7†ÂF–ÖVÆ–æUFööÆ&"çG7†à¢ÒFVÆWFRVçW6VB&'&VÂf–ÆW27&2ö6ö×öæVçG2÷f–FVòÖVF—F÷"ö–æFW‚çG6æB7&2ö6ö×öæVçG2÷f–FVòÖVF—F÷"÷f–FVõÆ–&6²ö–æFW‚çG6à¢ÒFVÆWFR÷'†æVBÖöGVÆR7&2öÆ–"öW‡÷'FW"öæF—fTg&ÖT6GW&RçG6æBÆVv7’G&t7W'6÷$öä6çf6–â7W'6÷%&VæFW&W"çG6à¢ÒFVÆWFR÷'†æVBÖöGVÆRVÆV7G&öâö—2öW‡÷'BöæF—fU7FF–4Æ–÷WE&÷WFUÆâçG6à £2â¢¥†6R3¢•2b&VÆöB–çFW&f6R‡–v–VæR¢ ¢ÒFVÆWFR†çFöÒVÆV7G&öä’ævWDÆ–çW…v–æF÷u7—7FVÖg&öÒ&VÆöBçG6æBVÆV7G&öâÖVçbæBçG6à¢Ò'VæRBFVB•2†æFÆW'27&÷72VÆV7G&öâö—2÷&Vv—7FW"öæB&VÆöBçG6à¢Ò&VÖ÷fRVæ6ÆÆVBW‡FVç6–öâ&Wf–Wr÷'FÂVæGö–çG2–âW‡FVç6–öä—2çG6æBW6TW‡FVç6–öç2çG6à £Bâ¢¥†6RC¢FVGWÆ–6F–öâ¢ ¢Ò6öç6öÆ–FFRÆÂ6Æ×æB6Æ×–×ÆVÖVçFF–öç2Fò7&2öÆ–"÷WF–Ç2çG6à¢ÒVæ–g’f÷&ÖEF–ÖVæBF–ÖV6öFRf÷&ÖGF–ær–â7&2öÆ–"öÖVF–F–Ö–ærçG6à¢Ò6VçG&Æ—¦Rdf×VrF–Ö–ær'6W'2–âVÆV7G&öâö—2öff×Vröf–ÇFW'2çG6à¢Ò&VÖ÷fRcbVçW6VB7W'6÷"5dw2g&öÒ7&2ö76WG2ö7W'6÷'2öà 