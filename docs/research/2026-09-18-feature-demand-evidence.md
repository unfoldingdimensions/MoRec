# Feature demand research — evidence file

**Date:** 2026-09-18 · Companion to [2026-09-18-feature-demand-research.md](2026-09-18-feature-demand-research.md). Collected by a research agent; every demand claim carries the URL it was read from.

**Method note.** Reddit and G2/Capterra block direct fetching, so Reddit quotes below come via aggregator articles actually read (labeled); all Hacker News quotes were pulled from the threads themselves; competitor pricing/features were verified on official pages. Sites like ScreenKite, cursorclip, vyds, and aitool.wiki are competitor/SEO blogs — used only for quotes they excerpt or as positioning evidence, and labeled.

---

## Feature candidates (ordered by evidence strength)

### 1. Instant share links, with privacy controls (unlisted links, passwords, view counts)
- **Evidence**: Loom's entire product is "record → link," and its G2 ease-of-sharing praise (192 mentions of "Easy Sharing") is the top adoption driver ([prospeo.io](https://prospeo.io/s/loom-pricing-reviews-pros-and-cons)). FocuSee users revolted when sharing was removed after acquisition: "add video sharing or at least a direct, in-app connection to users' Vimeo or Youtube channels, and we're immediately adding two more stars" ([Product Hunt FocuSee reviews](https://www.producthunt.com/products/focusee/reviews)). Screen Studio shipped shareable links in v3.0, then private links, link comments, and a view counter through 2025-26 ([screen.studio/changelog](https://www.screen.studio/changelog)).
- **Who has it**: Loom (free, 5-min capped), Cap (free: 5-min links; Pro: unlimited, passwords, custom domain — [cap.so/pricing](https://cap.so/pricing)), Screen Studio (paid), Tella (paid tiers), ScreenPal (free hosting, 10 videos — [affiliateprosolutions.com](https://affiliateprosolutions.com/screenpal-review/)).
- **Evidence strength**: **strong** — independent demand across users of 4+ tools, plus monetization proof (it's the paid/limited thing everywhere).

### 2. AI title, summary, and chapter generation from the transcript
- **Evidence**: Loom puts titles/summaries/chapters/CTA *only* in the +$6/user/mo "Business + AI" tier — the tier split itself is the willingness-to-pay signal ([loom.com/pricing](https://www.loom.com/pricing)); demand is high enough that Atlassian later pushed auto-titles down to every plan ([serchai.com](https://serchai.com/en/reviews/loom/)). Cap gates the same AI suite behind its $12/mo Pro tier ([cap.so/pricing](https://cap.so/pricing)). Camtasia locks AI titles/chapters/translations in its $599/yr Pro tier ([aiseekertools.com](https://aiseekertools.com/tools/camtasia) — review blog).
- **Who has it**: Loom (paid tier), Cap (paid tier), Tella ("AI Video Title" — [tella.com/features](https://www.tella.com/features)), Camtasia (top tier).
- **Evidence strength**: **strong** — three independent vendors monetize it identically; MoRec could do it locally from existing whisper transcripts.

### 3. Silence and filler-word removal (one-click audio/pace cleanup)
- **Evidence**: Loom's filler-word removal is specifically called out as the feature that "makes every video noticeably more polished — especially for sales reps who say 'um'" ([prospeo.io](https://prospeo.io/s/loom-pricing-reviews-pros-and-cons)). Tella ships "remove filler words and silences" in its AI Editing ([tella.com/features](https://www.tella.com/features)). Both gate it to paid tiers ([loom.com/pricing](https://www.loom.com/pricing)).
- **Who has it**: Loom (Business+AI), Tella (paid), Cap AI (transcripts/captions; filler removal not confirmed).
- **Evidence strength**: **strong-moderate** — two vendors monetize it, review praise is consistent; MoRec has the transcript data to implement word-level cuts already.

### 4. Transcript-based (text) editing — delete words in the transcript to cut video
- **Evidence**: Loom: "You edit by deleting words from the transcript, so there is no timeline to learn" — locked to Business+AI ([serchai.com](https://serchai.com/en/reviews/loom/); tier confirmed at [loom.com/pricing](https://www.loom.com/pricing)). Tella ships "trim by editing the transcript" ([tella.com/features](https://www.tella.com/features)). Camtasia's $249 Create tier's headline unlock is text-based editing ([aiseekertools.com](https://aiseekertools.com/tools/camtasia)).
- **Who has it**: Loom (paid), Tella (paid), Camtasia (Create $249/yr).
- **Evidence strength**: **strong-moderate** — consistent vendor adoption + paywalling = purchase intent; no primary "I want this" quote found, so not rated strong.

### 5. Bring-your-own storage / self-hosted sharing output (S3/R2, no cloud lock-in)
- **Evidence**: In the 462-point HN thread on a free Screen Studio alternative, multiple users asked for self-hosting and encode control ("customize encode quality and video size" — danudey), and flagged the privacy problem of cloud uploads: users may "leak secrets" (jofzar); others objected that recordings land on someone's S3 ([news.ycombinator.com/item?id=43816419](https://news.ycombinator.com/item?id=43816419)). Same sentiment on the Vento thread: "avoid the cloud part" (mrlinx) ([news.ycombinator.com/item?id=34406340](https://news.ycombinator.com/item?id=34406340)). Cap turned exactly this into a paid moat: custom S3/R2/Backblaze support on Pro ([github.com/CapSoftware/Cap](https://github.com/CapSoftware/Cap)).
- **Who has it**: Cap (Pro, $12/user/mo), Loom (no bulk export at all — a complaint: [vyds.io](https://vyds.io/blog/loom-pricing), competitor blog), Snapify (self-hostable, per HN mention in the OpenScreen thread).
- **Evidence strength**: **strong** — repeated independent primary voices; fits MoRec's local-first AGPL identity perfectly.

### 6. Resumable, reliable export with honest progress and file-size control
- **Evidence**: "Recording Issues" is Loom's #1 G2 con with 147 mentions; crashes, stuck uploads and lost recordings dominate its 1.4/5 Trustpilot page ("I've spent more time re-recording videos because of bugs than getting any value") ([prospeo.io](https://prospeo.io/s/loom-pricing-reviews-pros-and-cons); [trustpilot.com/review/loom.com](https://www.trustpilot.com/review/loom.com)). FocuSee users: "Each time, the software crashes at 53%" after 6 export attempts ([focusee-voice.imobie.com](https://focusee-voice.imobie.com/p/new-user-audio-sync-and-export-crash-issues)), and "Imagine doing a 20 minute video and all progress gone because it crashes at export" ([AppSumo Q&A](https://appsumo.com/products/focusee/questions/for-some-reason-everytime-i-try-to-expor-1127249/)). Screen Studio's 40 GB 3-hour file is a viral Product Hunt con ([cursorclip.com](https://cursorclip.com/blog/screen-studio-vs-loom), competitor blog quoting PH), and SS itself rewrote its export engine twice for speed ([screen.studio/changelog](https://www.screen.studio/changelog)).
- **Who has it**: everyone claims it; differentiator is crash-safe/resumable background export — Screen Studio added project recovery and low-disk warnings in 3.2 ([changelog](https://www.screen.studio/changelog)); MoRec already has crash-safe persistence, so the gap is export-time resilience + size presets.
- **Evidence strength**: **strong** (as a demand/pain), though it's a quality bar more than a shippable "feature."

### 7. Record-over-mistakes / retake-over (rewind and fix without restarting)
- **Evidence**: Vento's founder on why it exists: mistakes are "worse when you're already 5 minutes into your recording, forcing you to restart completely" — the Show HN drew 224 points/59 comments ([news.ycombinator.com/item?id=34406340](https://news.ycombinator.com/item?id=34406340)). A commenter summed up the alternative: doing it in editing software is "super annoying and a time sink" (chmod775, same thread). Tella ships the adjacent version: "record multiple clips instead of one take" plus reusable clips ([tella.com/features](https://www.tella.com/features)).
- **Who has it**: Vento (dedicated), Tella (paid multi-clip); Loom/Camtasia don't.
- **Evidence strength**: **moderate-strong** — one strong primary thread + one competitor shipping it; MoRec already has pause/resume, so this is the incremental "rewind-and-overdub" step.

### 8. Privacy mask / blur of sensitive info (ideally tracking scrolled content)
- **Evidence**: Screen Studio shipped a masking tool + highlight mask in 3.1.0 (Mar 2025) — shipping it into a paid flagship is itself demand evidence ([screen.studio/changelog](https://www.screen.studio/changelog)). A user in the 462-point HN thread asked for AI-driven masking that tracks scrolling content (birdman3131) ([HN 43816419](https://news.ycombinator.com/item?id=43816419)).
- **Who has it**: Screen Studio (paid), Camtasia (blur callouts), Tella (cropping; no auto-mask).
- **Evidence strength**: **moderate** — one direct user request + vendor adoption.

### 9. Automatic speed-up of typing/loading/dead-air segments
- **Evidence**: User request: "speed it up super fast" while typing (sgallant) ([HN 43816419](https://news.ycombinator.com/item?id=43816419)). Screen Studio auto-detects typing and suggests speeding it up (v3.0) — flagship adoption ([changelog](https://www.screen.studio/changelog)). FocuSee users punish its absence: "the built in video editor has no way to speed up portions of the video. This is such a common and basic element of tech tutorial videos" ([AppSumo review](https://appsumo.com/products/focusee/reviews/a-good-tool-worth-the-price-but-falls-309347/)).
- **Who has it**: Screen Studio (paid, auto-detect); MoRec has manual speed regions — the auto-detection is the gap.
- **Evidence strength**: **moderate-strong** — request + adoption + an absence complaint, though the request is from one primary voice.

### 10. Audio pre-flight check: live input meters, clipping warnings, output monitoring
- **Evidence**: OBS's ideas portal shows a 7-year fight for a master output meter: "This is BASIC BASIC BASIC audio… The equivalent in video: no video output window" — dozens of independent voices, an open bounty, a rejected PR ([ideas.obsproject.com/posts/170](https://ideas.obsproject.com/posts/170/output-volume-visualization-master-mix)). Screen Studio shipped repeated mic/audio fixes and stereo support across 3.6-3.7 ([changelog](https://www.screen.studio/changelog)), and system-audio failures at record time are a reported complaint category ([screenkite.com](https://www.screenkite.com/it/blog/screen-studio-complaints-2026-why-creators-switch), competitor blog).
- **Who has it**: OBS (input meters only), most recorders show a mic bar; per-recording "will my mic actually capture?" confidence checks are rare.
- **Evidence strength**: **moderate** — intense primary demand inside OBS's streamer-centric context; generalization to tutorial creators is an inference.

### 11. Webcam layout switching across the timeline (camera-only ↔ PiP without re-recording)
- **Evidence**: FocuSee buyer's top complaint: on Windows he can't record camera+screen acceptably and "can't switch from camera only to PiP with a window" inside a project, forcing a second app ([AppSumo review](https://appsumo.com/products/focusee/reviews/a-good-tool-worth-the-price-but-falls-309347/)). Screen Studio shipped "dynamic camera layouts" (fullscreen camera intro, hiding camera) in v3.0 ([changelog](https://www.screen.studio/changelog)). Tella ships Multi-Layouts ([tella.com/features](https://www.tella.com/features)).
- **Who has it**: Screen Studio, Tella (both paid); FocuSee users explicitly want it.
- **Evidence strength**: **moderate** — MoRec's dynamic webcam bubble covers position/zoom-reactive behavior; segment-level camera-only switches appear to be the gap.

### 12. Make the "magic" optional: disable/preset auto-zoom and motion effects
- **Evidence**: "mouse movement zooms in with 'no way to turn it off' is a deal breaker" (birdman3131) and Screen Studio's "constant panning/zooming to be very distracting and almost dizzying" (IshKebab) ([HN 47595695](https://news.ycombinator.com/item?id=47595695), [HN 43816419](https://news.ycombinator.com/item?id=43816419)). Another request: presets "for a consistent look to the motion effects" (alin23) and zoom as "a slider instead of preset options" (ramkarthikk) ([HN 47595695](https://news.ycombinator.com/item?id=47595695)). Screen Studio added a disable-auto-zoom toggle ([changelog](https://www.screen.studio/changelog)) and reviewers note the tension between auto-zoom and demo clarity ([matte.app](https://matte.app/blog/screen-studio-review), competitor blog).
- **Who has it**: Screen Studio (toggle); fine-grained "calm/energetic" motion profiles are mostly unclaimed.
- **Evidence strength**: **moderate** — multiple primary voices, and it directly validates MoRec's auto-suggestion + manual-region design.

### 13. Teleprompter / speaker notes while recording
- **Evidence**: Three independent competitors now ship it: FocuSee ("built-in teleprompter while recording" — [App Store listing](https://apps.apple.com/us/app/focusee-ai-screen-recorder/id6472626992?mt=12)), Screen Studio (speaker notes + prompter speed options — [changelog](https://www.screen.studio/changelog)), Tella ("Speaker Notes: show your talking points while recording" — [tella.com/features](https://www.tella.com/features)).
- **Who has it**: FocuSee, Screen Studio, Tella (all paid tiers).
- **Evidence strength**: **moderate** — adoption signal is consistent; no primary user quote demanding it was found, so treat as trend-following rather than proven pull.

### 14. Voiceover narration recorded onto the timeline after filming
- **Evidence**: Screen Studio Product Hunt cons: "no audio voiceover/transcription… hope some of these features would be rolled out" ([factchecktool.com](https://factchecktool.com/en/tools/screenshots-and-screen-recording/screen-studio), quoting PH reviews); FocuSee reviewers ask for "better voice import, narration control" ([producthunt.com](https://www.producthunt.com/products/focusee/reviews) — review-summary page). Camtasia monetizes the inverse (AI voiceover replacement) ([aiseekertools.com](https://aiseekertools.com/tools/camtasia)).
- **Who has it**: Camtasia (full audio editing; AI voiceover paid), ScreenFlow (not verified this session); Screen Studio historically lacked it.
- **Evidence strength**: **moderate-weak** — recurring review-site complaints, but via secondary pages.

### 15. One recording → many formats: 9:16/1:1/4:5 social reformat and device mockups
- **Evidence**: Screen Studio iterated hard here — 4:5 ratio, iPhone mirroring, and a stream of iPhone mockup releases ([changelog](https://www.screen.studio/changelog)). FocuSee advertises canvas sizes "for YouTube Shorts, TikTok, LinkedIn" ([App Store listing](https://apps.apple.com/us/app/focusee-ai-screen-recorder/id6472626992?mt=12)). Camtasia markets Smart Focus for "converting landscape long-form videos into engaging portrait short videos" ([redditmedia repost of r/CamtasiaStudio post](https://www.redditmedia.com/r/CamtasiaStudio/comments/1iwt0ym/camtasia_smart_focus_feature_give_it_a_try/) — enthusiastic fan post).
- **Who has it**: Screen Studio, FocuSee, Camtasia (all paid).
- **Evidence strength**: **moderate** — strong vendor-side adoption; user-voice demand is thin in what was read (label: inference that the mockup release cadence tracks demand).

### 16. Guaranteed raw MP4 export + portable projects (anti-lock-in)
- **Evidence**: User complaint that export produced only "a specific link" rather than the raw MP4 (TrapLord_Rhodo) ([HN 43816419](https://news.ycombinator.com/item?id=43816419)). Camtasia's subscription lock-in anger is precisely about project files: "Ten to one, those 2025 files will not be readable using my 2024 software" (r/CamtasiaStudio, quoted in [costbench.com](https://costbench.com/software/screen-recording/camtasia/hidden-costs/) — aggregator of Reddit quotes). Loom's free tier won't even let you download your own recordings ([vyds.io](https://vyds.io/blog/loom-pricing), competitor blog).
- **Who has it**: all desktop editors export files; the differentiator is promising it contractually (open project format, no watermark/no tiers on export).
- **Evidence strength**: **moderate** — the lock-in pain is strong and multi-sourced; as a *feature* it's a positioning commitment for MoRec.

### 17. GIF export (short loops for docs/social)
- **Evidence**: FocuSee ships "Export animated GIFs for quick sharing" ([App Store listing](https://apps.apple.com/us/app/focusee-ai-screen-recorder/id6472626992?mt=12)); Tella ships GIF thumbnails ([tella.com/features](https://www.tella.com/features)); Kap, the GIF-first macOS recorder, holds 19.4k GitHub stars ([github.com/wulkano/Kap](https://github.com/wulkano/Kap)) — a proxy signal, not a user request.
- **Who has it**: FocuSee, Tella, CleanShot X, ScreenToGif (free).
- **Evidence strength**: **weak-moderate** — no direct user quotes found in these sources; cheap add-on for MoRec given ffmpeg.

### 18. Keyboard-shortcut overlay rendered into the video
- **Evidence**: FocuSee ships "Display recorded keyboard shortcuts" ([App Store listing](https://apps.apple.com/us/app/focusee-ai-screen-recorder/id6472626992?mt=12)); no user quotes surfaced in the reading — this one rests on vendor adoption alone.
- **Who has it**: FocuSee; Screen Studio reportedly not (no changelog entry seen).
- **Evidence strength**: **weak** — include only as a low-cost differentiator, not a demand-driven bet.

---

## Demand patterns

1. **Subscription rage is a growth engine for free tools.** The loudest demand signal in 2025-26 isn't a feature — it's pricing. "Screen Studio at $29/mo is unusually and extremely expensive for a video recorder app" ([HN 47595695](https://news.ycombinator.com/item?id=47595695)); the three biggest Screen Studio alternative threads on HN in one week scored 462/434/34 points ([hn.algolia.com](https://hn.algolia.com/api/v1/search?query=%22Screen%20Studio%22&tags=story)); even the 2023 launch thread's first question was "can I pay monthly?" for a one-off video ([aitool.wiki](https://aitool.wiki/screen-studio-review/), SEO blog quoting HN). Free + AGPL + a paid one-time option is itself the top "feature."
2. **Reliability is the #1 complaint in every tool checked** — Loom's top G2 con ("Recording Issues," 147 mentions — [prospeo.io](https://prospeo.io/s/loom-pricing-reviews-pros-and-cons)), FocuSee export crashes ([forum](https://focusee-voice.imobie.com/p/new-user-audio-sync-and-export-crash-issues)), Screen Studio endless-crash reports ([HN 43816419](https://news.ycombinator.com/item?id=43816419)), and even SS's 5-minute update-check scandal ([news.ycombinator.com/item?id=43832992](https://news.ycombinator.com/item?id=43832992)). Users forgive missing features; they don't forgive lost takes.
3. **The money is in post-production and distribution, not recording.** Everything vendors paywall or tier-gate clusters in two places: AI cleanup (Loom +$6 AI tier, Camtasia Pro) and sharing (links, privacy, analytics) — confirmed across [loom.com/pricing](https://www.loom.com/pricing), [cap.so/pricing](https://cap.so/pricing), [aiseekertools.com](https://aiseekertools.com/tools/camtasia).
4. **"Make the magic optional"** — auto-zoom/motion effects are the hook, but users demand off-switches, sliders, and consistent presets ([HN 47595695](https://news.ycombinator.com/item?id=47595695); [matte.app](https://matte.app/blog/screen-studio-review)). Auto-suggestions (MoRec's current model) are the right shape; the demand is for control dials on top.
5. **One take → many outputs.** The same recording gets repurposed as a link, a trimmed MP4, a portrait short, a GIF, and a transcript — every 2025-26 competitor roadmap converges on multi-format output from a single capture.
6. **Privacy is a wedge.** Fear of leaking secrets in recordings (HN), masking tools shipping in paid flagships, and anger at default-public or cloud-hosted recordings all point the same way — a local-first recorder should say "nothing leaves your disk" louder, and sell masking as a feature.

## Coverage gaps

Reddit, G2, and Capterra could not be read directly (bot-blocked); the OBS ideas portal rendered only partially (top-vote ranking unavailable); Screen Studio X/Twitter mentions were not mined (no X access). No claim above rests on a source that wasn't opened this session.
