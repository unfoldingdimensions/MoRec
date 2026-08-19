# MoRec Pre-Launch UI/UX & Interaction Audit Report

**Date**: 2026-08-20  
**Auditor**: UI/UX & Interaction Explorer Subagent  
**Scope**: Complete pre-launch UI/UX, styling, visual hierarchy, layout responsiveness, accessibility, theme consistency, and interaction design audit of MoRec.  
**Repository Root**: `e:\New-Personal-Projects\MoRec`

---

## Executive Summary

An exhaustive audit of the MoRec desktop screen recording and video editor application was conducted across all 9 target scopes. MoRec demonstrates an impressive, modern design aesthetic with smooth animations, custom glass/skate shaders, and rich interaction models. However, several critical UI/UX flaws, production blockers, visual hierarchy bugs, z-index layering inversions, accessibility violations (WCAG 2.1 AA), and dead code components were identified that must be resolved prior to production launch.

### Summary of Audit Findings by Severity

| Severity | Count | Primary Impact Areas |
| :--- | :---: | :--- |
| **Blocker** | 1 | Header social/feedback/bug report links broken (empty URL strings triggering runtime error toasts) |
| **Critical** | 3 | Static non-resizable panels (unused `react-resizable-panels`), `CropControl` missing corner handles/aspect ratio lock, Radix Select/Dropdown z-index inversion inside Dialogs |
| **Major** | 10 | Double-card nesting & double delete buttons in Annotation Settings, `ProjectPopover` overflow bug, unlocalized strings in Project Browser, Pixi fallback obtrusive backdrop, missing countdown accessibility/live regions, focus ring suppression, low contrast micro-copy |
| **Minor / Suggestion** | 11 | Orphaned dead code (`SourceSelector.module.css`, `KeyboardShortcutsHelp.tsx`, `FormatSelector.tsx`, `GifOptionsPanel.tsx`), `SliderControl` ignoring input, disabled button tooltip focusability, light-mode audio level meter inversion, format toggle visual inconsistency |
| **Total Findings** | **25** | |

---

## Detailed Findings Catalog

---

### Scope 1: Recording Launcher, Floating / Mini Overlay Bar & Popovers

#### [UI-001] `ProjectPopover` Double-Border, Overflow & Container Nesting Glitch
- **Category**: Layout / Visual Polish
- **Severity**: Major
- **File Link**: [`file:///e:/New-Personal-Projects/MoRec/src/components/launch/popovers/ProjectPopover.tsx`](file:///e:/New-Personal-Projects/MoRec/src/components/launch/popovers/ProjectPopover.tsx) (Lines 34–45)  
  [`file:///e:/New-Personal-Projects/MoRec/src/components/video-editor/ProjectBrowserDialog.tsx`](file:///e:/New-Personal-Projects/MoRec/src/components/video-editor/ProjectBrowserDialog.tsx) (Lines 177–178)
- **Observed Behavior & Visual Flaw**: When opening the Project Browser from the HUD overlay More menu, `ProjectPopover` renders `ProjectBrowserDialog` with `renderMode="inline"`. `HudPopover` wraps children in `styles.menuCard` (which already defines `width: 300px`, `padding: 8px`, border, background, shadow, and border-radius). Inside it, `ProjectBrowserDialog` renders another 300px container (`w-[300px] max-h-[400px] rounded-[14px] border bg-editor-panel shadow-2xl`). This produces a double border, double background, redundant shadow, and causes horizontal overflow clipping within the 300px parent popover.
- **Root Cause Analysis**: The inline render mode of `ProjectBrowserDialog` was authored with standalone card styles (`w-[300px]`, `border`, `bg-editor-panel`, `shadow`) instead of acting as a transparent content layout that seamlessly inherits the host popover card.
- **Recommended Fix**:
  In `src/components/video-editor/ProjectBrowserDialog.tsx`, adjust `renderMode === "inline"` to strip duplicate container styles:
  ```tsx
  // Before:
  <div
    ref={panelRef}
    role="dialog"
    aria-label="Projects"
    className="pointer-events-auto mb-1.5 w-[300px] max-h-[400px] overflow-hidden rounded-[14px] border border-foreground/[0.07] bg-editor-panel/[0.96] text-foreground shadow-[0_12px_32px_rgba(0,0,0,0.22),0_2px_10px_rgba(0,0,0,0.1)] animate-in fade-in-0 duration-150"
  >

  // After:
  <div
    ref={panelRef}
    role="dialog"
    aria-label="Projects"
    className="pointer-events-auto w-full max-h-[360px] overflow-hidden text-foreground bg-transparent border-0 shadow-none"
  >
  ```

---

#### [UI-002] Untranslated Hardcoded Strings in `ProjectBrowserDialog`
- **Category**: UI/UX / Internationalization
- **Severity**: Major
- **File Link**: [`file:///e:/New-Personal-Projects/MoRec/src/components/video-editor/ProjectBrowserDialog.tsx`](file:///e:/New-Personal-Projects/MoRec/src/components/video-editor/ProjectBrowserDialog.tsx) (Lines 181, 189, 217, 223, 240, 260, 268, 298, 304, 321)
- **Observed Behavior & Visual Flaw**: All text inside `ProjectBrowserDialog`—including `"Projects"`, `"Import"`, `"No preview yet"`, `"Current"`, and `"No saved projects yet"`—is hardcoded in English. When the user switches languages via the HUD More popover or editor settings, this dialog remains entirely in English.
- **Root Cause Analysis**: `ProjectBrowserDialog` does not import `useScopedT` or `useI18n`.
- **Recommended Fix**:
  Import `useScopedT` in `ProjectBrowserDialog.tsx` and wrap all static strings:
  ```tsx
  import { useScopedT } from "@/contexts/I18nContext";
  // ...
  const t = useScopedT("editor");
  // Replace:
  // "Projects" -> t("project.dialogTitle", "Projects")
  // "Import" -> t("project.import", "Import")
  // "No preview yet" -> t("project.noPreview", "No preview yet")
  // "Current" -> t("project.currentBadge", "Current")
  // "No saved projects yet" -> t("project.noProjects", "No saved projects yet")
  ```

---

#### [UI-003] `SourceSelector.module.css` Orphaned / Dead Styling Artifact
- **Category**: Styling / Technical Debt
- **Severity**: Minor
- **File Link**: [`file:///e:/New-Personal-Projects/MoRec/src/components/launch/SourceSelector.module.css`](file:///e:/New-Personal-Projects/MoRec/src/components/launch/SourceSelector.module.css) (Lines 1–75)
- **Observed Behavior & Visual Flaw**: 75 lines of CSS class definitions (`.glassContainer`, `.sourceCard`, `.selected`, `.icon`, `.name`, `.cardText`, `.sourceGridScroll`) exist in `SourceSelector.module.css` but are never imported or referenced in the entire application.
- **Root Cause Analysis**: `SourceSelector` was refactored to use Tailwind CSS and `SourceSelector.css`, leaving the CSS module file orphaned.
- **Recommended Fix**: Safely delete `src/components/launch/SourceSelector.module.css`.

---

#### [UI-004] HUD Inactive Audio Level Meter Inversion in Light Mode
- **Category**: Theme / Visual Hierarchy
- **Severity**: Minor
- **File Link**: [`file:///e:/New-Personal-Projects/MoRec/src/components/ui/audio-level-meter.tsx`](file:///e:/New-Personal-Projects/MoRec/src/components/ui/audio-level-meter.tsx) (Line 15)
- **Observed Behavior & Visual Flaw**: In light mode, inactive audio meter bars render with `bg-slate-700` (#334155). On a white HUD popover background (`#ffffff`), inactive bars appear as prominent, dark solid squares—visually stronger than the active colored bars (blue/yellow/red)—inverting the visual hierarchy.
- **Root Cause Analysis**: `getBarColor` hardcodes the dark slate color string `"bg-slate-700"` without considering light mode theme contexts.
- **Recommended Fix**:
  ```tsx
  // Replace in getBarColor (line 15):
  if (!level || level < threshold) return "bg-foreground/15 dark:bg-slate-700/60";
  ```

---

#### [UI-005] Marquee Animation Jerkiness on Source Name Truncation
- **Category**: UI/UX / Animations
- **Severity**: Minor
- **File Link**: [`file:///e:/New-Personal-Projects/MoRec/src/components/launch/SourceSelector.css`](file:///e:/New-Personal-Projects/MoRec/src/components/launch/SourceSelector.css) (Lines 135–142)  
  [`file:///e:/New-Personal-Projects/MoRec/src/components/launch/SourceSelector.tsx`](file:///e:/New-Personal-Projects/MoRec/src/components/launch/SourceSelector.tsx) (Lines 64–70)
- **Observed Behavior & Visual Flaw**: Hovering over long screen or window titles triggers a linear `@keyframes source-selector-marquee` translating `-50%` over 10s. For strings only slightly longer than the container (e.g. 5px overflow), this scrolls the entire duplicate segment unnecessarily far and resets abruptly with no pause.
- **Root Cause Analysis**: Fixed-duration `-50%` animation does not adapt to actual text overflow width.
- **Recommended Fix**: Add a keyframe pause at `0%` and `80%` or calculate dynamic animation duration based on overflow pixel distance.

---

### Scope 2: Countdown Overlay & Update Toast Modal

#### [UI-006] Missing Accessibility Semantics & Live Region Announcements in Countdown Overlay
- **Category**: Accessibility / Interaction Polish
- **Severity**: Major
- **File Link**: [`file:///e:/New-Personal-Projects/MoRec/src/components/countdown/CountdownOverlay.tsx`](file:///e:/New-Personal-Projects/MoRec/src/components/countdown/CountdownOverlay.tsx) (Lines 43–68)
- **Observed Behavior & Visual Flaw**: The countdown overlay is a plain `<div>` with `onClick` and a window keydown listener. Screen readers receive zero announcements when the countdown activates or ticks down. Additionally, there is no visible dismissal instruction for users unfamiliar with keyboard shortcuts (no `"Press Esc to Cancel"` prompt).
- **Root Cause Analysis**: The component lacks ARIA live region attributes, semantic modal roles, and visible accessible cues.
- **Recommended Fix**:
  Update `CountdownOverlay.tsx`:
  ```tsx
  <div
    role="status"
    aria-live="assertive"
    aria-atomic="true"
    aria-label={`Recording starts in ${countdown} seconds. Click or press Escape to cancel.`}
    className="fixed inset-0 flex flex-col items-center justify-center select-none cursor-pointer"
    onClick={handleCancel}
  >
    <div
      className="flex flex-col items-center justify-center rounded-3xl p-6"
      style={{
        width: 200,
        height: 200,
        background: "rgba(0, 0, 0, 0.85)",
        backdropFilter: "blur(20px)",
      }}
    >
      <span className="text-white font-bold tabular-nums text-7xl animate-pulse">
        {countdown}
      </span>
      <span className="text-white/60 text-xs mt-2 font-medium">
        Press Esc to cancel
      </span>
    </div>
  </div>
  ```

---

#### [UI-007] `UpdateToastWindow` Polling Overhead & Hardcoded Dark Palette
- **Category**: UI/UX / Theme Consistency
- **Severity**: Major
- **File Link**: [`file:///e:/New-Personal-Projects/MoRec/src/components/launch/UpdateToastWindow.tsx`](file:///e:/New-Personal-Projects/MoRec/src/components/launch/UpdateToastWindow.tsx) (Lines 94–100, 147–230, 369–381)
- **Observed Behavior & Visual Flaw**:
  1. The component runs an active `setInterval` polling `getCurrentUpdateToastPayload` every 750ms despite already subscribing to push events via `onUpdateToastStateChanged`.
  2. The window uses hardcoded inline styles (`#0b1220`, `#3b82f6`, `#dbeafe`) and bypasses all Tailwind theme variables.
  3. The reminder dropdown is an unstyled native `<select>` lacking an accessible label (`aria-label`), custom chevron, or theme styling.
  4. All UI strings (`"Update Prompt Preview"`, `"Try Again"`, `"Install & Restart"`, `"Later"`, etc.) are untranslated.
- **Root Cause Analysis**: Authored as an isolated standalone prototype window without integration into the shared theme and i18n system.
- **Recommended Fix**: Remove the redundant interval timer, apply `launch-theme` CSS classes, add `aria-label="Reminder delay"` to the select element, and wire up `useI18n`.

---

### Scope 3: Video Editor Workspace Layout, Panels & Responsive Sizing

#### [UI-008] Non-Resizable Fixed Editor Panels with Hardcoded Height / Width Clamping
- **Category**: Layout / UI/UX
- **Severity**: Critical
- **File Link**: [`file:///e:/New-Personal-Projects/MoRec/src/components/video-editor/VideoEditor.tsx`](file:///e:/New-Personal-Projects/MoRec/src/components/video-editor/VideoEditor.tsx) (Lines 6270, 6838–6840)  
  [`file:///e:/New-Personal-Projects/MoRec/package.json`](file:///e:/New-Personal-Projects/MoRec/package.json) (Line 87)
- **Observed Behavior & Visual Flaw**:
  1. The settings sidebar is hardcoded to `w-[332px] min-w-[280px] max-w-[332px]`.
  2. The timeline container is hardcoded to `height: "15%", minHeight: 160`.
  3. When users enable multiple tracks (Video Clips, Source Audio, Custom Audio, Captions, Annotations, Zoom), the timeline content exceeds 160px and clips vertically, forcing awkward internal scrolling with no way to drag to expand the timeline.
  4. `react-resizable-panels` is installed in `package.json` (`^3.0.6`) but is completely unused.
- **Root Cause Analysis**: Static CSS flexbox layouts were implemented without wiring up `PanelGroup`, `Panel`, and `PanelResizeHandle`.
- **Recommended Fix**:
  Integrate `react-resizable-panels` into `VideoEditor.tsx`:
  - Wrap the Preview Viewport and Timeline in a vertical `PanelGroup` with a draggable `PanelResizeHandle`.
  - Wrap the Settings Sidebar and Main Content in a horizontal `PanelGroup`.
  - Persist user panel size preferences to `localStorage`.

---

#### [UI-009] Broken External Social, Feedback & Bug Report Links in Header
- **Category**: UI/UX / Interaction Polish
- **Severity**: Blocker
- **File Link**: [`file:///e:/New-Personal-Projects/MoRec/src/components/video-editor/TutorialHelp.tsx`](file:///e:/New-Personal-Projects/MoRec/src/components/video-editor/TutorialHelp.tsx) (Lines 27–30, 68, 128, 149, 164)
- **Observed Behavior & Visual Flaw**:
  `MOREC_ISSUES_URL = ""`, `MOREC_DISCORD_URL = ""`, `MOREC_X_URL = ""`, and `CONTACT_EMAIL = ""` are defined as empty strings `""`.
  Clicking "Join Discord" in the main editor header, or opening the Feedback dialog and clicking "Report issue / send feedback", "Email", or "X" triggers `openExternalUrl("")`, which fails and displays error toast notifications: `"Failed to open link."`.
- **Root Cause Analysis**: Placeholder empty string constants were left unpopulated prior to release.
- **Recommended Fix**:
  Provide valid fallback URLs (e.g. GitHub repository issues URL, official Discord/X links) and ensure `openExternalLink` verifies that the URL is non-empty before calling Electron IPC, rendering the button in a disabled or fallback state if the URL is unavailable:
  ```ts
  export const MOREC_ISSUES_URL = "https://github.com/unfoldingdimensions/MoRec/issues";
  export const MOREC_DISCORD_URL = "https://discord.gg/morec";
  export const MOREC_X_URL = "https://x.com/morecapp";
  export const CONTACT_EMAIL = "support@morec.app";
  ```

---

#### [UI-010] Duplicate `KeyboardShortcutsHelp.tsx` Dead Code Component
- **Category**: Code Quality / Dead Code
- **Severity**: Minor
- **File Link**: [`file:///e:/New-Personal-Projects/MoRec/src/components/video-editor/KeyboardShortcutsHelp.tsx`](file:///e:/New-Personal-Projects/MoRec/src/components/video-editor/KeyboardShortcutsHelp.tsx) (Lines 1–84)
- **Observed Behavior & Visual Flaw**: `KeyboardShortcutsHelp.tsx` defines a tooltip-based shortcuts popover that is never imported or mounted anywhere in the application. It was superseded by `KeyboardShortcutsDialog` in `TutorialHelp.tsx`.
- **Root Cause Analysis**: Abandoned legacy component left in repository after migrating to dialog-based shortcut help.
- **Recommended Fix**: Remove `src/components/video-editor/KeyboardShortcutsHelp.tsx`.

---

### Scope 4: Timeline UI, Playhead, Scrubbing & Rulers

#### [UI-011] Limited Keyframe Snapping During Playhead Drag with No Visual Snapping Indicator
- **Category**: Interaction / Timeline UX
- **Severity**: Major
- **File Link**: [`file:///e:/New-Personal-Projects/MoRec/src/components/video-editor/timeline/components/playhead/PlaybackCursor.tsx`](file:///e:/New-Personal-Projects/MoRec/src/components/video-editor/timeline/components/playhead/PlaybackCursor.tsx) (Lines 37–45)
- **Observed Behavior & Visual Flaw**:
  When scrubbing or dragging the playhead on the timeline, snapping only evaluates the `keyframes` array (which only contains zoom keyframes). It completely ignores clip split points, trim in/out points, audio clip boundaries, and caption cue start/end times. Furthermore, when snapping occurs, there is zero visual feedback (no magnetic guideline line, dot, or haptic color flash).
- **Root Cause Analysis**: `PlaybackCursor` was only passed `keyframes` instead of an aggregated list of all timeline region boundaries.
- **Recommended Fix**:
  1. Pass an aggregated `snapPoints: number[]` array (including clip boundaries, audio boundaries, caption cue timings, and zoom keyframes) to `PlaybackCursor`.
  2. When snapped (`Math.abs(snapPoint - absoluteMs) <= snapThresholdMs`), render a subtle vertical snap indicator line with a brief color accent transition on the playhead head.

---

#### [UI-012] Hardcoded English Tooltips and Labels on Timeline Items
- **Category**: Accessibility / Internationalization
- **Severity**: Minor
- **File Link**: [`file:///e:/New-Personal-Projects/MoRec/src/components/video-editor/timeline/Item.tsx`](file:///e:/New-Personal-Projects/MoRec/src/components/video-editor/timeline/Item.tsx) (Lines 115, 196, 201, 233, 240, 252, 280)
- **Observed Behavior & Visual Flaw**:
  Timeline blocks hardcode English strings for `"Resize left"`, `"Resize right"`, `"Trim"`, `"Clip"`, `"Speed"`, `"Manual"`, `"Auto"`, and `"Loading..."`. When switching languages, these timeline tags remain in English.
- **Root Cause Analysis**: `Item.tsx` does not utilize `useScopedT("timeline")`.
- **Recommended Fix**: Import `useScopedT` in `Item.tsx` and replace hardcoded literals with translation tokens.

---

### Scope 5: Canvas Preview & Viewport, Crop Controls & Overlays

#### [UI-013] `CropControl` Missing Corner Handles, Move Interaction, and Aspect Ratio Locking
- **Category**: Interaction Design / Video Canvas
- **Severity**: Critical
- **File Link**: [`file:///e:/New-Personal-Projects/MoRec/src/components/video-editor/CropControl.tsx`](file:///e:/New-Personal-Projects/MoRec/src/components/video-editor/CropControl.tsx) (Lines 19–21, 104–131, 213–271)
- **Observed Behavior & Visual Flaw**:
  1. `CropControl.tsx` only implements 4 side handles (`top`, `bottom`, `left`, `right`). Corner drag handles (`nw`, `ne`, `se`, `sw`) are missing.
  2. There is no inner drag handle or gesture to move/pan the cropped bounding box across the video.
  3. The `aspectRatio` prop is accepted by the component interface but ignored in calculation (no aspect ratio locking).
  4. The drag handle hit areas are only 3px wide (`h-[3px]`, `w-[3px]`), making them nearly impossible to grab accurately.
  5. Unlike `WebcamCropControl.tsx`, there are no rule-of-thirds grid guides, keyboard step adjustments, or pixel dimension indicators.
- **Root Cause Analysis**: `CropControl` was written with an early minimal prototype implementation while `WebcamCropControl` received a full accessible overhaul.
- **Recommended Fix**:
  Refactor `CropControl.tsx` adopting the architecture from `WebcamCropControl.tsx`:
  - Add 4 corner handles and a center move handle.
  - Expand hit areas with invisible padding (`after:absolute after:-inset-2`).
  - Add aspect ratio lock toggle (`Freeform` vs `Lock to ${aspectRatio}`).
  - Add rule-of-thirds grid overlays and dimension badges (`1920 × 1080`).

---

#### [UI-014] Obtrusive Full-Screen Backdrop Overlay on Pixi Fallback
- **Category**: UI/UX / Error States
- **Severity**: Major
- **File Link**: [`file:///e:/New-Personal-Projects/MoRec/src/components/video-editor/VideoPlayback.tsx`](file:///e:/New-Personal-Projects/MoRec/src/components/video-editor/VideoPlayback.tsx) (Lines 3022–3030)
- **Observed Behavior & Visual Flaw**: When WebGL / Pixi fails to initialize and falls back to native 2D video rendering, a full-screen dark overlay (`bg-black/60`) is permanently rendered on top of the entire video preview with a static message, blocking the user from previewing their video edits.
- **Root Cause Analysis**: Fallback warning was rendered as a blocking viewport overlay rather than a non-obstructive toast or banner.
- **Recommended Fix**: Replace the centered modal backdrop with a dismissible notification banner at the top of the canvas or trigger a toast notification via Sonner (`toast.warning(...)`).

---

### Scope 6: Settings Panels & Shortcuts Configuration

#### [UI-015] Duplicate "Delete Annotation" Buttons Stacked in Settings Panel
- **Category**: UI/UX / Layout Glitch
- **Severity**: Major
- **File Link**: [`file:///e:/New-Personal-Projects/MoRec/src/components/video-editor/AnnotationSettingsPanel.tsx`](file:///e:/New-Personal-Projects/MoRec/src/components/video-editor/AnnotationSettingsPanel.tsx) (Lines 813–823)  
  [`file:///e:/New-Personal-Projects/MoRec/src/components/video-editor/SettingsPanel.tsx`](file:///e:/New-Personal-Projects/MoRec/src/components/video-editor/SettingsPanel.tsx) (Lines 4372–4385)
- **Observed Behavior & Visual Flaw**: When an annotation is selected, `AnnotationSettingsPanel` renders its own bottom delete button (`onDelete`), and `SettingsPanel` simultaneously renders a second delete button in its footer for `selectedAnnotationId`. This causes two identical red "Delete Annotation" buttons to render directly stacked on top of each other.
- **Root Cause Analysis**: Both the sub-panel and the parent container attempted to handle deletion action rendering independently.
- **Recommended Fix**: Remove the duplicate delete button footer from `AnnotationSettingsPanel.tsx` (lines 813–823) and let `SettingsPanel.tsx`'s unified footer manage deletion.

---

#### [UI-016] Double Container Card & Nested Scrollbars in `AnnotationSettingsPanel`
- **Category**: Layout / Styling
- **Severity**: Major
- **File Link**: [`file:///e:/New-Personal-Projects/MoRec/src/components/video-editor/AnnotationSettingsPanel.tsx`](file:///e:/New-Personal-Projects/MoRec/src/components/video-editor/AnnotationSettingsPanel.tsx) (Lines 150–151)  
  [`file:///e:/New-Personal-Projects/MoRec/src/components/video-editor/SettingsPanel.tsx`](file:///e:/New-Personal-Projects/MoRec/src/components/video-editor/SettingsPanel.tsx) (Lines 4303–4305)
- **Observed Behavior & Visual Flaw**: `AnnotationSettingsPanel` wraps its root element in `<div className="flex-[2] min-w-0 bg-editor-panel border border-foreground/10 rounded-2xl flex flex-col shadow-xl h-full overflow-hidden">` with its own internal scroll container, while already rendered inside `SettingsPanel`'s identical outer card container. This results in double borders, double backgrounds, double shadows, and conflicting nested scrollbars.
- **Root Cause Analysis**: `AnnotationSettingsPanel` was written as an independent panel layout rather than a composable form view.
- **Recommended Fix**: Change `AnnotationSettingsPanel`'s root element to a simple `div` (`className="space-y-4"`) without the card wrapper, border, shadow, or fixed height.

---

#### [UI-017] `SliderControl` Ignores `parseInput` & Missing Standard Slider Keyboard Navigation
- **Category**: Accessibility / Interaction Polish
- **Severity**: Minor
- **File Link**: [`file:///e:/New-Personal-Projects/MoRec/src/components/video-editor/SliderControl.tsx`](file:///e:/New-Personal-Projects/MoRec/src/components/video-editor/SliderControl.tsx) (Lines 29, 35, 151–161)
- **Observed Behavior & Visual Flaw**:
  1. `SliderControl` accepts `parseInput: _parseInput` in its props but ignores it. Users cannot click or double-click to type exact numeric values.
  2. Keyboard navigation only supports Arrow keys. Standard WAI-ARIA slider keys (`Home` to jump to min, `End` to jump to max, `PageUp`/`PageDown` for 10x step increments) are unhandled.
- **Root Cause Analysis**: Incomplete implementation of WAI-ARIA slider keyboard patterns and direct value input editing.
- **Recommended Fix**: Handle `Home`, `End`, `PageUp`, `PageDown` in `onKeyDown` and allow clicking the value text to toggle an inline `<input type="number">`.

---

#### [UI-018] Orphaned `FormatSelector.tsx` and `GifOptionsPanel.tsx` Components
- **Category**: Code Quality / Dead Code
- **Severity**: Minor
- **File Link**: [`file:///e:/New-Personal-Projects/MoRec/src/components/video-editor/FormatSelector.tsx`](file:///e:/New-Personal-Projects/MoRec/src/components/video-editor/FormatSelector.tsx) (Lines 1–83)  
  [`file:///e:/New-Personal-Projects/MoRec/src/components/video-editor/GifOptionsPanel.tsx`](file:///e:/New-Personal-Projects/MoRec/src/components/video-editor/GifOptionsPanel.tsx) (Lines 1–121)
- **Observed Behavior & Visual Flaw**: Both files are unused dead code components with duplicate UI logic, completely orphaned after their options were embedded into `ExportSettingsMenu.tsx`.
- **Root Cause Analysis**: Legacy components remained in the directory after consolidating export controls.
- **Recommended Fix**: Safely remove `FormatSelector.tsx` and `GifOptionsPanel.tsx`.

---

### Scope 7: Export Dialogs & Progress Modals

#### [UI-019] Visual Style Inconsistency Between Export Format & Quality Pills
- **Category**: Theme / Visual Consistency
- **Severity**: Minor
- **File Link**: [`file:///e:/New-Personal-Projects/MoRec/src/components/video-editor/ExportSettingsMenu.tsx`](file:///e:/New-Personal-Projects/MoRec/src/components/video-editor/ExportSettingsMenu.tsx) (Lines 107–120, 152–160, 220–228, 260–268)
- **Observed Behavior & Visual Flaw**: In `ExportSettingsMenu`, the MP4/GIF format switch uses a blue outline with translucent blue pill (`border-[#2563EB]/50 bg-[#2563EB]/10`), whereas the Quality, Encoding, FPS, and Pipeline options use solid monochrome inverted pills (`bg-neutral-800 dark:bg-white`).
- **Root Cause Analysis**: Divergent styling patterns applied to segmented toggle groups in the same menu.
- **Recommended Fix**: Standardize all segment toggles in `ExportSettingsMenu` to use a cohesive pill design (e.g. brand accent or theme surface token).

---

### Scope 8: Theme Consistency, Contrast & Z-Index Layering

#### [UI-020] Z-Index Inversion: Radix Select & Dropdowns Render Behind Radix Dialogs
- **Category**: Z-Index Layering / Accessibility
- **Severity**: Critical
- **File Link**: [`file:///e:/New-Personal-Projects/MoRec/src/components/ui/dialog.tsx`](file:///e:/New-Personal-Projects/MoRec/src/components/ui/dialog.tsx) (Lines 22, 39)  
  [`file:///e:/New-Personal-Projects/MoRec/src/components/ui/select.tsx`](file:///e:/New-Personal-Projects/MoRec/src/components/ui/select.tsx) (Line 71)  
  [`file:///e:/New-Personal-Projects/MoRec/src/components/ui/dropdown-menu.tsx`](file:///e:/New-Personal-Projects/MoRec/src/components/ui/dropdown-menu.tsx) (Lines 47, 64)  
  [`file:///e:/New-Personal-Projects/MoRec/src/components/ui/popover.tsx`](file:///e:/New-Personal-Projects/MoRec/src/components/ui/popover.tsx) (Lines 36–37)
- **Observed Behavior & Visual Flaw**:
  `DialogOverlay` is configured with `z-[9999]` and `DialogContent` with `z-[10000]`. However, `SelectContent`, `DropdownMenuContent`, and `PopoverContent` have `z-50`.
  When a `<Select>` or `<DropdownMenu>` is rendered inside any Dialog (such as `AddCustomFontDialog`, `ShortcutsConfigDialog`, or future modal settings), Radix portals the floating menu into `document.body` with `z-50`, placing it completely underneath the modal backdrop (`z-[9999]`) and making it invisible and impossible to click.
- **Root Cause Analysis**: The modal layer was assigned an arbitrary high z-index (`z-[10000]`) without elevating portaled popover/dropdown components above modal overlays.
- **Recommended Fix**:
  Establish a clean z-index hierarchy:
  - Header / Toolbars: `z-30`
  - Floating HUD Bar: `z-40`
  - Popovers / Dropdown Menus: `z-50` (or `z-[10001]` when portaled inside dialogs)
  - Dialog Backdrop: `z-[100]`
  - Dialog Content: `z-[101]`
  - Tooltips / Toasts: `z-[200]`
  In `select.tsx`, `dropdown-menu.tsx`, and `popover.tsx`, set portaled content to `z-[10001]` or use `z-[var(--popover-z,50)]`.

---

#### [UI-021] Crop Modal Z-Index Clash with Application Header
- **Category**: Z-Index Layering
- **Severity**: Major
- **File Link**: [`file:///e:/New-Personal-Projects/MoRec/src/components/video-editor/VideoEditor.tsx`](file:///e:/New-Personal-Projects/MoRec/src/components/video-editor/VideoEditor.tsx) (Lines 5813, 6912–6915)
- **Observed Behavior & Visual Flaw**: The App Header is set to `z-50`. When the Crop Modal opens, its manual backdrop is also set to `z-50`, causing header buttons and tooltip triggers to fight for stacking context and visually bleed over the backdrop.
- **Root Cause Analysis**: `CropModal` was built with ad-hoc `z-50` / `z-[60]` classes rather than standard dialog portal tokens.
- **Recommended Fix**: Migrate `CropModal` to use `<Dialog>` from `@/components/ui/dialog`.

---

#### [UI-022] Low Contrast Ratio on Sub-11px Micro-Copy Violating WCAG 2.1 AA
- **Category**: Theme / Accessibility
- **Severity**: Major
- **File Link**: [`file:///e:/New-Personal-Projects/MoRec/src/index.css`](file:///e:/New-Personal-Projects/MoRec/src/index.css) (Lines 46, 91)  
  [`file:///e:/New-Personal-Projects/MoRec/src/components/video-editor/ExportSettingsMenu.tsx`](file:///e:/New-Personal-Projects/MoRec/src/components/video-editor/ExportSettingsMenu.tsx) (Lines 175–180, 191, 244, 285, 336)
- **Observed Behavior & Visual Flaw**: In Dark Mode, `--muted-foreground` at 70% opacity on `--editor-surface` yields a contrast ratio of ~3.2:1 against the dark surface background. On tiny text sizes (8px–10px: `text-[8px]`, `text-[9px]`, `text-[10px]`), this text is illegible and fails WCAG 2.1 AA (minimum 4.5:1 for normal text).
- **Root Cause Analysis**: Widespread combination of sub-11px font sizes with fractional opacity utilities (`text-muted-foreground/70`).
- **Recommended Fix**: Bump font sizes to a minimum of 11px (`text-[11px]`) and increase text color contrast to meet 4.5:1.

---

### Scope 9: Accessibility & Interaction Polish

#### [UI-023] Destructive Focus Ring Suppression on Interactive Controls
- **Category**: Accessibility / Keyboard Navigation
- **Severity**: Major
- **File Link**: [`file:///e:/New-Personal-Projects/MoRec/src/components/video-editor/ProjectBrowserDialog.tsx`](file:///e:/New-Personal-Projects/MoRec/src/components/video-editor/ProjectBrowserDialog.tsx) (Lines 205, 287)  
  [`file:///e:/New-Personal-Projects/MoRec/src/components/video-editor/VideoEditor.tsx`](file:///e:/New-Personal-Projects/MoRec/src/components/video-editor/VideoEditor.tsx) (Lines 6281, 6343)
- **Observed Behavior & Visual Flaw**: Multiple interactive buttons (project cards, icon rail buttons, user account button) explicitly include `focus:outline-none focus-visible:outline-none focus-visible:ring-0`. This completely destroys keyboard focus indicators, leaving keyboard navigation invisible.
- **Root Cause Analysis**: Over-aggressive focus styling resets.
- **Recommended Fix**: Remove `focus-visible:outline-none` and `focus-visible:ring-0`, letting the global `*:focus-visible` ring in `index.css` take effect.

---

#### [UI-024] Unclamped / Unhandled Keyboard Shortcut Trapping in `ShortcutsConfigDialog`
- **Category**: Interaction Polish / Accessibility
- **Severity**: Minor
- **File Link**: [`file:///e:/New-Personal-Projects/MoRec/src/components/video-editor/ShortcutsConfigDialog.tsx`](file:///e:/New-Personal-Projects/MoRec/src/components/video-editor/ShortcutsConfigDialog.tsx) (Lines 54–94)
- **Observed Behavior & Visual Flaw**: When a user clicks to record a shortcut (`captureFor` active), the global capturing keydown listener intercepts `Tab`, `Space`, and Function keys without filtering or escape fallback on outside click, trapping standard dialog navigation.
- **Root Cause Analysis**: Missing key exclusion filters for navigation keys in the recording hook.
- **Recommended Fix**: Allow bare `Tab` to navigate or cancel capture, and add a click-outside handler to reset `captureFor`.

---

#### [UI-025] Disabled Button Tooltip Inaccessibility in `RecordingControls`
- **Category**: Accessibility / Tooltip Polish
- **Severity**: Minor
- **File Link**: [`file:///e:/New-Personal-Projects/MoRec/src/components/launch/RecordingControls.tsx`](file:///e:/New-Personal-Projects/MoRec/src/components/launch/RecordingControls.tsx) (Lines 69–85)
- **Observed Behavior & Visual Flaw**: The disabled microphone button is wrapped in a `<span title="...">` over `<Button disabled>`. Because HTML disabled buttons cannot receive keyboard focus, keyboard-only users cannot access the tooltip explaining why the microphone toggle is locked during active recording.
- **Root Cause Analysis**: Using HTML `disabled` attribute rather than `aria-disabled="true"`.
- **Recommended Fix**: Use `aria-disabled="true"` so the button remains keyboard-focusable to display its tooltip and describe the state via `aria-describedby`.

---

## Synthesis & Recommended Remediation Roadmap

1. **Immediate Pre-Launch Blockers**:
   - Fix empty link URLs in `TutorialHelp.tsx` ([UI-009]).
   - Fix z-index inversion for Radix Select/Dropdown inside Dialogs ([UI-020]).
   - Remove duplicate delete buttons and double card containers in Annotation Settings ([UI-015], [UI-016]).
   - Fix `ProjectPopover` double card overflow bug ([UI-001]).

2. **Core Visual & Layout Polish**:
   - Implement `react-resizable-panels` across the Video Editor layout ([UI-008]).
   - Upgrade `CropControl.tsx` with corner handles, move handle, and aspect ratio locking ([UI-013]).
   - Replace obtrusive Pixi fallback overlay with a dismissible banner ([UI-014]).
   - Remove dead code files `SourceSelector.module.css`, `KeyboardShortcutsHelp.tsx`, `FormatSelector.tsx`, `GifOptionsPanel.tsx` ([UI-003], [UI-010], [UI-018]).

3. **Accessibility & Design Consistency**:
   - Restore keyboard focus rings by removing `focus-visible:ring-0` overrides ([UI-023]).
   - Add ARIA live regions and status role to `CountdownOverlay` ([UI-006]).
   - Localize untranslated strings in `ProjectBrowserDialog` and timeline item tags ([UI-002], [UI-012]).
   - Fix light mode inactive audio meter contrast inversion ([UI-004]).
   - Resolve WCAG 2.1 AA micro-copy contrast violations ([UI-022]).
