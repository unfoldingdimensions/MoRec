# Renderer UI/UX + Accessibility + i18n Review — Windows

> **Status (2026-09-16):** Resolved with two deferred items. Findings fixed in PRs #13 and #14 (merged 2026-09-14); HUD keyboard access and the translation backlog were consciously deferred. Consolidated to main from review PR #8 before closing it; this file is the record copy.

- **Date:** 2026-09-13 · **Reviewed at:** `e6e7aee` (main)
- **Scope:** `src/App.tsx`, `src/components/launch/` (incl. `popovers/`, `contexts/`, `hooks/`, CSS), `src/components/countdown/`, `src/components/ui/`, `src/index.css`, `src/i18n/`, `tailwind.config.cjs`. Main-process window configs (`electron/windows.ts`, `electron/hudOverlayBounds.ts`) were read as contracts a finding's severity depends on.
- **Focus:** launch→countdown→recording→editor dead-ends; both themes; keyboard/focus/ARIA (Radix usage); contrast; i18n string gaps; HUD behavior at 125%/150% Windows scaling.
- **Method:** full read of every scoped file (21 ui primitives, all launch components/popovers/hooks, contexts, styles) plus the Electron window options each renderer finding depends on. Findings only — no fixes proposed, no code changed.

**Verification (what was actually run this session):**
- `node scripts/i18n-check.mjs` → passes clean ("structurally consistent", "all t() usage resolves"). Note its blind spot: the usage pass (scripts/i18n-check.mjs:147-149) **skips any file that never calls `t()`** — which is exactly why the fully-hardcoded `UpdateToastWindow.tsx` passes a green check.
- Locale diff script over all 8 namespaces × 10 non-en locales: **1,609 leaf values identical to the en source** (non-trivial strings, acronyms excluded).
- Contrast ratios computed with the WCAG relative-luminance formula (values quoted per finding below).
- **No app instance was launched** — no runtime screenshots; every "What you'd see" line is derived from code + window geometry, not a captured frame.

**Headline:** the launch HUD's state colors are **hardcoded for the dark theme only** — in light mode the "Preparing recording" finalizing state is effectively invisible (1.16:1) and the paused/active states fall below every WCAG threshold — while the update toast ships **zero i18n** on an app that advertises ten languages. Theme and language switches propagate nowhere outside the window they were made in, and the countdown overlay both hides a click-cancelsRecording trap and has an Escape handler that can never fire on Windows.

---

## Findings

### MAJOR

**M1. Light-theme HUD state colors are unreadable or invisible — `src/components/launch/LaunchWindow.module.css:176-202, 74-96` and `src/components/launch/RecordingControls.tsx:44-65`**

The HUD bar background is theme-aware (`--launch-bar-bg: rgba(255,255,255,0.98)` in light, `launchTheme.css:16`), but the state colors inside it are hardcoded dark-theme values with no light variant:

| Element | Color | On light bar | Threshold |
|---|---|---|---|
| Finalizing title (`finalizingState`, module.css:176-182) | `#eeeef2` | **1.16:1** | invisible |
| Finalizing subtitle (`finalizingCopy small`, :198-202) | `#8a8a96` @10px | 3.41:1 | 4.5:1 (text) |
| PAUSED dot + label (`RecordingControls.tsx:46-56`) | `#fbbf24` @10px | **1.67:1** | 4.5:1 (text) / 3:1 (graphical) |
| Resume icon (`ibGreen`, module.css:90-96) | `#34d399` | **1.92:1** | 3:1 (non-text) |
| REC label (`RecordingControls.tsx:51-55`) | `#f43f5e` @10px | 3.67:1 | 4.5:1 (text) |
| Active mic/cam/countdown icon (`ibActive`, :74-80) | `#3d8bff` | 3.31:1 | passes 3:1, but uses the dark-theme accent `#3d8bff` instead of light's `--launch-accent: #2563eb` (launchTheme.css:12) |

All of the same colors measure 5.1–11.2:1 on the dark bar, so the bug only reproduces in light mode — which is one click away in the same menu (MorePopover → Appearance → Light).

*What you'd see:* light theme, recording stopped — the HUD pill goes blank white with a lone blue spinner; the "Preparing recording / Opening the editor in a moment" copy is white-on-white. During a paused recording the amber "PAUSED" label and green resume icon are faint ghosts on white; the red REC text is washed out.

**M2. Update toast has zero i18n and hardcoded dark-only chrome — `src/components/launch/UpdateToastWindow.tsx:24-65, 131-144, 287, 329, 387`**

The entire user-facing surface is hardcoded English: reminder options "1 hour / 3 hours / Tomorrow / 3 days" (:24-29), all five titles ("Mo Rec X is available", "Installing…", "…is ready", "Could not check for updates", "…needs attention") (:44-61), buttons "Install & Restart" / "Try Again" / "Later" (:63-65, :387), stats "Downloaded / Left / Speed" (:131-144), "% complete" (:329), "Dev" badge (:287). No `useI18n`/`useScopedT` anywhere in the file, so i18n-check can't see it. Secondary issues in the same component:
- The reminder `<select>` (:216-229, :369-381) styles its trigger with `color: #dbeafe` on a dark gradient but never sets `color-scheme: dark` — the native popup list opens with the OS light scheme, so light-blue option text sits on a white list background (≈1.2:1). The HUD's mic popover had this exact fix (`micSelect`, LaunchWindow.module.css:299-306) — the toast didn't get it.
- No accessible names: the select has no label/`aria-label`, and the download progress (:293-313) is two styled divs with no `role="progressbar"`, value, or `aria-live`, so download progress is invisible to assistive tech.

*What you'd see:* a Russian/German user gets an English update dialog; opening the reminder dropdown shows a white native list with pale-blue, barely legible options; Narrator announces nothing while a 100 MB update downloads.

**M3. Theme and language changes never propagate across windows — `src/contexts/ThemeContext.tsx:73-79, 86-101` and `src/contexts/I18nContext.tsx:333-338`**

Each Electron window is its own renderer with its own provider; both contexts persist the choice to `localStorage` and read it back only at mount. There is no `storage`-event listener, no IPC broadcast, no main-process theme state. `setPreference`/`setLocale` therefore update only the window the menu was used in; every other already-open window keeps its old theme/locale until it is closed and reopened. (Only OS "system"-mode flips propagate, via each window's own `matchMedia` listener, ThemeContext.tsx:86-97.)

*What you'd see:* user switches Light→Dark in the HUD's More menu — the editor window, open on the other monitor, stays light; switching language to 한국어 in the HUD leaves the editor in English until the app is restarted.

**M4. Countdown: invisible click-cancels zone, dead Escape handler, no accessible state — `src/components/countdown/CountdownOverlay.tsx:20-47` + `electron/windows.ts:929-970`**

Three compounding issues on the one screen the user watches while starting a recording:
1. **Click-to-cancel is a hazard, not an affordance.** The renderer makes the whole window clickable (`fixed inset-0 … onClick={handleCancel}`, :42-47). The window is a fixed **200×200 px** square centered on the work area (windows.ts:933-941) — so a square region in the middle of the screen (the full 180×180 badge plus its rounded corners' hit area) silently cancels the countdown on any stray click, with no confirmation and no visible hint that clicking does anything.
2. **Escape is unreachable on Windows.** The Escape path (:24-36) needs the window focused, but on win32 the window is shown with `showInactive()` + `moveTop()` (windows.ts:963-968) and focus stays in the user's actual app. The only way to give it focus is to click it — which cancels. Escape is effectively dead code on Windows.
3. **No ARIA at all.** The countdown number (:57-66) is a bare `<span>` in a transparent window — no `role="timer"`, no `aria-live`, so screen-reader users get no announcement that recording is about to start, how long remains, or that it was cancelled.

*What you'd see:* a dark rounded "3" hovering mid-screen; the user reaches for their browser and their click lands in the badge's square bounding area — the countdown vanishes and recording never starts, no explanation. Pressing Escape does nothing. Narrator users hear nothing at any point.

**M5. Ten languages advertised, ~1,609 untranslated strings shipped, one locale orphaned, one mislabeled — `src/i18n/locales/*`, `src/i18n/config.ts:3-14`, `src/components/launch/popovers/MorePopover.tsx:24-34`, `src/components/launch/hooks/useLaunchWindowActions.ts:6, 61`**

- Every non-en locale still contains large amounts of English: 1,609 leaf strings identical to the en source across all namespaces (e.g. de `launch:recording.appearance` = "Appearance", de `launch:recording.preparing` = "Preparing recording", all locales `common:app.subtitle` = "Screen recording and editing"). The fallback chain (I18nContext.tsx:321-325) silently serves the English string, so the language menu promises "Español/Français/…" but delivers mixed-language UI. (Known deferred item from the 2026-08-29 policy decision — quantified here for the fix pass.)
- **`ru` exists on disk and passes i18n-check but is not in `SUPPORTED_LOCALES`** (config.ts:3-14) and is not imported into the message map (I18nContext.tsx:102-203): Russian files are maintained for nothing and Russian users get English. The i18n-check script walks all locale *directories* (i18n-check.mjs:9-13), so it green-lights a locale the app can never show.
- **`MorePopover.tsx:24-34`: `LOCALE_LABELS` is missing `de`** — the German menu item renders the raw code "de" (`LOCALE_LABELS[code] ?? code`, :173) while every other language shows a native name; and `"zh-CN": "簡體中文"` is written in **Traditional** characters (should be 简体中文).
- The HUD's source slot falls back to the hardcoded English word `"Screen"` (`useLaunchWindowActions.ts:6,61`, `SourceSelector.tsx:81,211`) in every locale, though a translated key (`launch:recording.screen`) already exists.

*What you'd see:* German user's HUD "More" menu — the language list reads "English / **de** / Español / …"; the Appearance section header says "Appearance"; the source button says "Screen" until a display is picked; a large share of the editor remains English after switching to any non-English language.

**M6. The HUD — the app's only recording entry point — is structurally keyboard- and screen-reader-inaccessible — `electron/windows.ts:414` + renderer gaps**

The HUD window is created with `focusable: false` (windows.ts:414), so nothing inside it can ever receive keyboard focus: no Tab order, no shortcuts, no focus-visible indicators, no screen-reader activation. That is a legitimate overlay-design choice, but the renderer compounds it so the surface has no accessible story even in principle:
- Primary idle controls identify themselves by `title` attribute only, no `aria-label` (mic LaunchWindow.tsx:274-293, webcam :314-333, countdown :338-349, record :351-366, more :403-408, hide :410-419, close :420-428) — `title` is a weak, tooltip-coupled accessible name, applied inconsistently (RecordingControls does use aria-labels, :69-137).
- The drag handle is a bare `<div>` with pointer handlers (:477-488) — no role, not focusable, no keyboard way to move the HUD.
- Custom popover rows are plain `<button>`s whose selected state is color-only — no `aria-checked`/`aria-pressed`/`role="menuitemradio"` (`PopoverScaffold.tsx:11-64`, `SourceSelector.tsx:89-133`, `WebcamPopover.tsx:111-132`), and no arrow-key navigation (Radix Popover provides container focus, not menu-item semantics).
- There is no non-HUD path to start recording: the main window is a static splash (App.tsx:80-99), so keyboard/SR users cannot record at all.

*What you'd see:* Narrator scan mode finds nothing to activate in the overlay; a keyboard-only user has no way to trigger recording, and a screen-reader user cannot tell which microphone is selected (selection is a color tint + icon swap only).

---

### MINOR

**m1. `Separator` renders nothing — its background color doesn't exist — `src/components/ui/separator.tsx:26-33` + `tailwind.config.cjs:43-94`**

The primitive applies `bg-separator`, but `separator` is not a configured color in the Tailwind theme (only `border`, `input`, etc. exist, tailwind.config.cjs:43-94), so the utility is never generated and the element is transparent. Every HUD divider — idle bar (LaunchWindow.tsx:256, 368) and recording bar (RecordingControls.tsx:67, 87) — renders as a 1px invisible gap.

*What you'd see:* the HUD pill with no vertical divider lines between the source button, mic, record button, and more section — groups run together, only spacing separates them.

**m2. Update toast: fixed 456×252 window with no scroll clips long content — `UpdateToastWindow.tsx:157-171` + `electron/windows.ts:43-44`**

The card (`maxWidth: 440`, no `maxHeight`, no overflow handling) sits in a fixed, non-resizable 456×252 window. A long `payload.detail` (3+ lines) plus the download-phase block (progress bar + up to three stat pills, :293-348) exceeds 252 px and is simply cut off at the window edge. Same geometry class: the HUD bar caps at `max-width: 1200px` (LaunchWindow.module.css:14) while the non-passthrough fallback window is 860 DIP wide (hudOverlayBounds.ts:8) — safe today because the source button is capped at 180px and labels are `nowrap`, but any wider locale string set clips silently.

*What you'd see:* an update toast whose last button row is sliced off mid-height — "Install & Restart" half-visible, no way to scroll.

**m3. Webcam preview drag clamps to screen size instead of the HUD window — can be dragged out of view — `src/components/launch/hooks/useWebcamPreviewOverlay.ts:119-132`**

The drag clamp uses `Math.max(window.innerWidth, window.screen?.width ?? 0)` (and height, :121-122), mixing window-relative coordinates with monitor dimensions. The HUD bar's own drag does it correctly with `window.innerWidth/innerHeight` (`hudViewportBounds.ts:30-39`, used by `useHudBarDrag.ts:136-137, 173-174`). Consequence: in passthrough mode (window = work area) the preview can be dragged down into the taskbar strip and get clipped; in non-passthrough fallback the window is only 160–540 px tall (hudOverlayBounds.ts:9-10) while the clamp allows the full screen height, so the preview is easily dragged entirely outside the window. The offset persists (`setWebcamPreviewOffset`, :159) until webcam is toggled off.

*What you'd see:* user drags the floating webcam bubble toward the bottom edge; it slides under the taskbar / off the HUD window and disappears mid-recording; toggling "hide/show preview" doesn't reset it — only disabling the webcam does.

**m4. Marquee text is exposed up to three times to screen readers; motion has no `prefers-reduced-motion` guards — `src/components/launch/SourceSelector.tsx:55-72` + `SourceSelector.css` (marquee rules) + `LaunchWindow.module.css:253-255`**

`MarqueeText` renders the static span plus an animated copy containing **two** segments (original + duplicate, :63-70). The animated container is hidden with `opacity: 0` (SourceSelector.css `.source-selector-marquee-animated`), which hides it visually but not from the accessibility tree (no `aria-hidden`, not `display:none`) — the repo's own SourceSelector render test documents that each label matches three times. None of the launch-layer animations (REC dot blink `recDotBlink`, marquee, the HUD state blur/scale transitions in LaunchWindow.tsx:496-514) are wrapped in `prefers-reduced-motion`; the only such media query in src is in `App.css:30` for unrelated content.

*What you'd see:* (AT) Narrator reads "Chrome — Chrome — Chrome" for one source row; (motion-sensitive users) an endlessly blinking red dot and auto-scrolling text with no OS setting honored.

**m5. Unselected devices wear "disabled" icons — `src/components/launch/popovers/PopoverScaffold.tsx:57-59` and `WebcamPopover.tsx:113-122`**

In the mic and webcam device lists, every non-selected device renders `MicrophoneSlashIcon` / `VideoCameraSlashIcon` — the same slashed icon used everywhere else for "off/muted" — although clicking it selects and enables the device. The icon language says "this device is off" when the action is "switch to this device."

*What you'd see:* a webcam list where four of five entries show crossed-out cameras; users read the list as "these devices are unavailable" and pick the wrong affordance.

**m6. Windows gets a macOS font stack, and the timer jitters — `src/index.css:31-34, 144-147`**

`--app-font-sans: "SF Pro Display", "SF Pro Text", Helvetica, sans-serif` — neither SF Pro nor Helvetica ships with Windows, so every surface renders in Chromium's generic sans default (Arial on stock Windows), not Segoe UI; there is no `fontFamily` extension in tailwind.config.cjs, so the `font-sans` utility diverges from the body stack too. Separately, `body .font-mono, body kbd { font-family: var(--app-font-sans) }` (:144-147) flattens the mono utility, so the recording timer (RecordingControls.tsx:60, `font-mono`, no `tabular-nums`) renders in a proportional face — digits change width each second and the centered text wobbles horizontally (the 52px `min-width` bounds it but doesn't steady it).

*What you'd see:* the whole app in Arial-ish letterforms on Windows instead of the OS UI font; during recording the elapsed time text subtly shifts left/right every second.

**m7. No way to abort from the HUD while finalizing or counting down — `src/components/launch/LaunchWindow.tsx:432-440, 362` + `src/hooks/useScreenRecorder.ts:1119, 1251`**

The finalizing state replaces the entire bar with spinner + copy (:432-440) — no cancel, no "open folder instead"; if muxing a long recording takes minutes the user can only watch (the window *does* recover via `hudOverlayClose` on success/failure, useScreenRecorder.ts:1220-1227, and a failed editor switch toasts, :721-732 — so it's a waiting-state gap, not a hang). During countdown the record button is `disabled` (:362) and popovers stay interactive, but there is no "cancel countdown" control in the bar itself — the only cancel affordance is the click-trap badge from M4.

*What you'd see:* after clicking stop, the bar becomes a white pill with a spinner and (in light mode, per M1) no text — no escape hatch until the editor appears.

**m8. Shared Dialog primitive hardcodes English "Close" — `src/components/ui/dialog.tsx:56-60`**

Every Radix dialog in the app renders a screen-reader-only `<span className="sr-only">Close</span>` for the X button. It bypasses i18n, so the close control is announced in English in all ten locales. (In the launch scope this affects the ProjectBrowser dialog rendered inside the HUD popover, ProjectPopover.tsx:34-45.)

*What you'd see:* (AT) a Japanese user hears "Close button" on a dialog that is otherwise fully localized.

**m9. Dark-theme windows flash light before React mounts — `index.html` (no theme init) + `src/contexts/ThemeContext.tsx:65-69`**

The `.dark` class is applied only in `ThemeProvider`'s state initializer, which runs when React mounts — the document paints from the default light `:root` tokens (index.css:31-78) before that. There is no inline bootstrap script in index.html (standard mitigation). Most visible on the opaque editor window (dark users see a white flash on every open); the transparent HUD/countdown windows flash whatever the OS paints beneath.

*What you'd see:* opening the editor in dark mode: a brief white rectangle, then the dark UI fades in. (Derived from code, not confirmed at runtime — flagged as likely.)

**m10. Focus indicators are thin where it matters — `src/components/ui/button.tsx` (buttonVariants `focus-visible:ring-1`) vs `src/index.css:11-15`**

The global stylesheet defines a 2px accent outline for `:focus-visible`, but the shared Button (used for every HUD control) opts out (`focus-visible:outline-none focus-visible:ring-1`) in favor of a **1px** ring in `--ring` blue. On the dark bar that ring is ~4:1 but hairline-thin (below the 2px/3:1 focus-appearance guidance in WCAG 2.2 §2.4.13); on the primary (filled blue) variant the blue ring sits against the blue fill. The update toast's raw buttons fall back to the global 2px outline at 3.62:1 on the navy card — visible but low.

*What you'd see:* (keyboard/AT, e.g. in the always-focusable source-selector or update-toast windows) a barely-there 1px blue halo on the focused button that disappears against similar-colored fills.

---

### LOW

**l1. `navigator.platform` is deprecated — `src/App.tsx:16`, `src/main.tsx:8`, `src/components/launch/UpdateToastWindow.tsx:146`**

Three separate `/mac/i.test(navigator.platform)` checks gate platform behavior (incl. the toast's Windows-vs-mac background, UpdateToastWindow.tsx:155). Still functional in Chromium, but deprecated; `navigator.userAgentData.platform` or the IPC `getPlatform()` the HUD already uses (useLaunchWindowSystemState.ts:34-48) are the supported paths — and the codebase already mixes both.

**l2. Dead styles shipped — `src/components/launch/LaunchWindow.module.css:299-306` and `src/components/launch/SourceSelector.module.css` (whole file)**

`.micSelect`/`.micSelect option` are referenced by no component (the mic device list is custom buttons, not a `<select>`), and `SourceSelector.module.css` (the dark `glassContainer`/`sourceCard` set) has no importer. Both are theme-relevant leftovers that will mislead the next reader — the `.micSelect` block in particular looks like the fix for M2's select problem, applied nowhere.

**l3. Hardcoded countdown units and hardcoded toasts adjacent to scope — `src/components/launch/popovers/CountdownPopover.tsx:48` and `src/hooks/useScreenRecorder.ts:715, 728-731, 1203-1206`**

`${delay}s` hardcodes the English unit suffix ("3s/5s/10s") in all locales; and while the hook layer is outside this review's file list, the recording flow's user-facing toasts ("Recording saved, but the audio companion could not be muxed." etc.) are hardcoded English and will show in every locale — same class as M2, one directory over.

**l4. Decorative meters/icons not hidden from assistive tech — `src/components/ui/audio-level-meter.tsx:14-33`**

The five-bar level meter inside each mic row conveys information (input level) via color/height only — no `role="meter"`, no `aria-hidden`, no text alternative; AT users get silence or noise from ten unlabeled divs. (Folded into the M6 semantics gap if a fix pass groups them.)

---

### Scaling notes (125% / 150%)

Electron sizes all five window types in DIPs, so 125%/150% scale the windows and content uniformly — no layout breaks found at either setting specifically. The scale-adjacent risks are the fixed-geometry ones above: the toast's fixed 456×252 window vs unbounded card height (m2), the 860-DIP fallback HUD width vs the bar's 1200px max-width headroom (m2), and the preview drag clamp that mixes screen and window coordinate spaces (m3), whose clipping window grows as the HUD window's DIP size shrinks at higher scale factors.
