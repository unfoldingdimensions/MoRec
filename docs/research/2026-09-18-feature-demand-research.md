# Feature demand research — what users want from tools like MoRec

**Date:** 2026-09-18 · **Mode:** web research (user-demand signals + competitor parity) → prioritized, codebase-grounded roadmap

**Method:** Primary user-demand signals (Hacker News threads, OBS ideas portal, Product Hunt / AppSumo review excerpts, competitor changelogs and pricing pages). Reddit/G2/Capterra were bot-blocked; Reddit-sourced quotes come via aggregators and are labeled. Every demand claim in the evidence file carries the URL it came from. Difficulty ratings below are grounded in this codebase (Electron + React timeline, ffmpeg export graphs, whisper transcripts, uiohook input capture, WGC/ScreenCaptureKit native layer, extension system, atomic persistence).

**Full evidence file:** [2026-09-18-feature-demand-evidence.md](2026-09-18-feature-demand-evidence.md)

## Priority summary

| # | Feature | Priority | Difficulty | Why (evidence) | Why this difficulty (codebase) |
|---|---------|----------|------------|----------------|-------------------------------|
| 1 | Motion presets + "make the magic optional" controls (disable/zoom-slider/consistent profiles) | P0 | Easy | HN: constant auto-zoom is "a deal breaker", "almost dizzying"; requests for presets and a zoom slider; Screen Studio shipped a disable toggle | Auto-zoom is already suggestion-based + manual regions; presets = config surface + export params, no new subsystems |
| 2 | One-click silence removal | P0 | Medium | Loom/Tella paywall it; praised in reviews as the polish-maker | Whisper word timestamps exist; ffmpeg silencedetect + timeline cut generation reuses existing region machinery |
| 3 | Auto speed-up of typing / dead air | P0 | Medium | Direct HN request; Screen Studio's signature auto-detection; FocuSee punished for lacking manual version | uiohook key telemetry already captured; auto-zoom suggestion pipeline can emit speed regions the same way |
| 4 | Export reliability pack: crash-safe/resumable export, honest progress, file-size presets | P0 | Medium | "Recording Issues" is Loom's #1 con (147 G2 mentions); FocuSee loses exports at 53%; users lose 20-min takes | Export progress/watchdogs just hardened (PR #24); atomic persistence exists; resumability = checkpointed segment renders |
| 5 | Audio pre-flight check (live meters, clipping warnings, output monitor before recording) | P0 | Easy | OBS ideas portal: 7-year fight for output metering, "This is BASIC BASIC audio"; system-audio failure complaints | Mic level meter (`useAudioLevelMeter`) already exists; add system-audio loopback meter + pre-record warning UX |
| 6 | GIF export + social canvas presets (9:16/1:1/4:5) | P0 | Easy | One-take-many-outputs is the 2025-26 convergence across Screen Studio/FocuSee/Camtasia; GIF shipping everywhere | ffmpeg palette-based GIF pipeline; canvas presets are crop/export settings — no new subsystems |
| 7 | Privacy mask / blur regions (static first) | P1 | Medium | Screen Studio shipped masking in a paid flagship; HN request for scroll-tracking masks; privacy is a local-first wedge | New annotation type; export-side region blur via ffmpeg filters; tracking = later AI step |
| 8 | Multi-clip recording (record segments, assemble on timeline) | P1 | Medium | Vento built an entire product on retake pain (224-pt HN thread); Tella ships multi-clip on paid tiers | Segment capture sessions + stitch-on-timeline; reuses project persistence; avoids in-place audio overdub complexity |
| 9 | Transcript-based (text) editing — delete words to cut video | P1 | Hard | Loom/Camtasia/Tella all paywall text editing; it is Camtasia Create-tier's headline | Requires word-time→cut mapping through the timeline model + export graphs; biggest architectural lift on this list |
| 10 | AI titles / summaries / chapters from transcript | P1 | Medium | Monetized identically by Loom, Cap, Camtasia — the tier split *is* the willingness-to-pay signal | Transcripts exist; local heuristics (zoom/silence boundaries) or user-supplied API key; no first-party cloud |
| 11 | Bring-your-own cloud upload for sharing (S3/R2/Backblaze) | P1 | Medium | HN: users want sharing without "the cloud part" / fear leaking secrets; Cap built a paid moat on exactly this | Upload client + destination presets; no MoRec backend needed — the local-first-compatible version of "share links" |
| 12 | Teleprompter / speaker notes in the HUD | P1 | Easy | FocuSee, Screen Studio, Tella all ship it on paid tiers | HUD overlay window exists; scrolling notes panel is pure renderer work |
| 13 | Voiceover narration recorded onto the timeline after filming | P2 | Medium | Recurring review complaints about Screen Studio/FocuSee lacking it (secondary sources) | Extra audio regions already exist; adds mic-capture-into-region flow + sync |
| 14 | Keyboard-shortcut overlay rendered into the video | P2 | Medium | FocuSee ships it; no direct user quotes found (vendor-adoption-only signal) | uiohook key events already captured for cursor telemetry; overlay widget joins the cursor renderer |
| 15 | Smart reframe (subject-tracking portrait crops) | P2 | Hard | Camtasia markets Smart Focus for landscape→portrait; vendor adoption strong, user-voice thin | Requires tracked-subject detection feeding crop regions through export — AI scope beyond current roadmap |
| 16 | MoRec-hosted share links | Not now | XL | Strongest raw demand in the research (Loom's whole model) — but requires backend infrastructure | Deliberately deferred: contradicts local-first/AGPL identity; revisit only if BYO-cloud upload (11) proves demand |

## Demand patterns (cross-cutting, from the evidence file)

1. **Reliability is the #1 complaint in every tool checked** — lost takes/exports beat every missing feature.
2. **The money is in post-production and distribution** — vendors paywall AI cleanup and sharing, not recording.
3. **Make the magic optional** — auto-zoom hooks users; control dials keep them.
4. **One take → many outputs** — link, trimmed MP4, portrait short, GIF, transcript.
5. **Privacy is a wedge** — masking + "nothing leaves your disk" is a local-first superpower.
6. **Free-vs-subscription rage is itself the top feature** — MoRec's free + AGPL positioning is the loudest demand signal in the data.
