# Main-process security review — remediation status

Companion to `2026-09-13-main-process-security-review.md` (PR #4). Branch: `fix/main-process-security` (PR #23), base `main@7663684`. Every code fix was developed by a generator agent, verified by an independent verifier agent (full electron suite + `tsc` on every round), and re-attacked by a fresh adversarial reviewer before landing; objections triggered revision rounds (F2 and F3 each took one, F8–F12's batch took one).

## Dispositions

| Finding | Disposition | Commit |
|---|---|---|
| H1 — renderer-writable read allowlist → arbitrary file read | **Fixed** | `bfc720f` |
| H2 — `generate-auto-captions` executes renderer-chosen executable → RCE | **Fixed** (dedicated exec-consent set; export-stream staging primitive closed) | `8e4c510` |
| H3 — extension system ships arbitrary code; silent enable/install | **Mitigated** (consent gates; renderer-side honor-the-refusal). Main-world isolation remains an architectural task — see Residuals | `781ac27` |
| M1 — `set-recording-preferences` merge redirects `recordingsDir` | **Fixed** (folded into H1's commit: the recordings-dir prefix added there is only safe once this file cannot be renderer-poisoned) | `bfc720f` |
| M2 — sidecar/telemetry paths from renderer input | **Fixed** (depends on H1's approval gating — committed after it for exactly that reason) | `e00d6b3` |
| M3 — Windows updates have no Authenticode anchor | **Cannot be fixed in code without a signing certificate** — see below | — |
| M4 — media server: no Host validation, no token | **Fixed** (Host must be `127.0.0.1:<bound port>`; per-start capability token on `/video`) | `a289652` |
| M5 — marketplace fetch follows redirects past the origin allowlist | **Fixed** (per-hop origin re-validation). Artifact checksums remain a server-side gap | `148b929` |
| L1 — `reveal-in-folder` opens renderer-chosen paths | **Fixed** (+ realpath pairing so junction/mapped-drive exports still reveal) | `80aa8d8` |
| L2 — whole temp dir is a read-allowlist prefix | **Fixed** (temp admits only `morec-*` / `.morec-*` first segments) | `fa1c3c1` |
| L3 — native helpers resolved from user-writable userData | **No change needed on Windows** — verified: the Windows capture/cursor helpers (`wgc-capture.exe`, `cursor-monitor.exe`) resolve to app-bundle/build paths (`resolvePreferredWindowsNativeHelperPath`); the `userData/native-tools` locations are macOS compile outputs | — |
| L4 — admin marketplace API reachable from every renderer | **Mitigated** (channels ship unregistered unless `MOREC_ADMIN_KEY` is set). Per-caller auth residual documented below | `ba306cb` |
| L5 — `openExternal` receives the raw string | **Fixed** (opens the normalized href; userinfo rejected) | `b557626` |
| L6 — `app-settings:set` accepts arbitrary keys | **Fixed** (prototype-pollution keys rejected; the H1 commit's settings whitelist already closed the load-bearing instance) | `751e84f` |

## M3 — what is required to actually fix it (external action)

Code signing is a release-engineering dependency, not a patch:

1. Obtain an OV (or EV) code-signing certificate for the publisher identity.
2. Add signing config to `electron-builder.json5` (`win.certificateSubjectName` / `signingHashAlgorithms`, or Azure Trusted Signing), sign in CI with the cert secret.
3. Add `win.publisherName` (electron-updater verifies the installer's Authenticode subject against it). **Do not add `publisherName` before builds are actually signed** — updates would fail verification and refuse to install.
4. Keep `MOREC_UPDATE_FEED_URL` for dev only; it remains an env-controlled override.

Until then the update channel's integrity rests on TLS to the GitHub feed plus the `latest.yml` sha512 served from that same feed (and conservative defaults: `autoDownload`/`autoInstallOnAppQuit` are off; installs are user-click-gated).

## Residuals (stated by the panel, accepted for this pass)

- **Extension code still runs in the renderer main world.** Consent gates (H3 commit) prevent silent install/activation and the UI honors refusal, but a compromised renderer can call renderer-side host APIs directly. Real isolation = separate context/BrowserView execution — architectural follow-up.
- **Admin marketplace calls authenticate the operator's key, not the caller** (L4). With `MOREC_ADMIN_KEY` set, any window can invoke the two admin channels and the main process attaches the key. In-band per-caller auth would require shipping the key into the renderer — worse. Unset, the surface is absent.
- **Marketplace zip artifacts have no checksum** (M5). Server-side: publish a checksum the client verifies.
- **Download-count beacon still uses plain `fetch`** (M5 follow-up): credential-free, target already trusted; fold into `fetchWithTrustedRedirects` in a follow-up.
- **`approveUserExecutablePath` binds path, not content** (H2): an approved whisper executable could be swapped on disk by a same-privilege local process before execution — identical to the trust of the original pick. Hash-pinning at consent time is a possible hardening.
- **Persisted whisper executable paths fail closed after app restart** (H2 consequence): in-memory exec consent means users re-pick the whisper binary per session unless it resolves from bundled/PATH. Intentional.
- **Fire-and-forget UX notes:** enable/install consent dialogs can be spammed by a renderer (pre-existing native-dialog surface); a hostile extension id/name is sanitized before display (control chars, bidi overrides, 80-char cap).

## Verification summary (final state of the branch)

- Full electron suite: 54 files, **575 passed / 1 skipped** (pre-existing Windows platform-skip), 0 failed.
- `tsc --noEmit -p tsconfig.node.json` and renderer `tsc --noEmit`: clean. `biome lint` clean on all touched files.
- Security-regression tests added per fix (approval gates + junction pairing, whisper exec-consent, export-stream extension matrix, consent/sanitizer gates, sidecar/telemetry gates with mutation checks, media-server Host/token over real sockets, marketplace redirect matrix, reveal/admin/external/settings/temp gates).
