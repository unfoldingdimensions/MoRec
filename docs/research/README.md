# Audit & Review Reports

Findings-only review reports for MoRec. Each report names file:line and severity; the status header at the top of each file says whether and how the findings landed. Convention: fix PRs that close audit findings update the matching report's status line in the same PR.

All eight audits are consolidated here; every review PR (#1–#8) is closed and its branch deleted. Follow-up remediation status docs are listed below the table.

| Date | Report | Review PR | Status |
|------|--------|-----------|--------|
| 2026-09-13 | [Recording lifecycle](2026-09-13-recording-lifecycle-review.md) | #1 (merged) | All findings fixed; fixes merged to main |
| 2026-09-13 | [Video editor UI/UX](2026-09-13-video-editor-ux-review.md) | #2 (closed) | All findings fixed in #9 |
| 2026-09-13 | [Audio/captions pipeline](2026-09-13-audio-captions-pipeline-review.md) | #3 (closed) | All findings fixed in #16, format follow-up in #21 |
| 2026-09-13 | [Main-process security](2026-09-13-main-process-security-review.md) | #4 (closed) | All actionable findings remediated in #23; M3 = signing-cert dependency; residuals in the remediation doc |
| 2026-09-13 | [Windows export pipeline](2026-09-13-export-pipeline-review.md) | #5 (merged) | High findings H1–H5 fixed in #24 |
| 2026-09-13 | [Windows native layer](2026-09-13-windows-native-layer-review.md) | #6 (closed) | H1–H3, M1–M5, L1/L3–L5 fixed in #25; L2 deferred |
| 2026-09-13 | [Persistence & crash safety](2026-09-13-persistence-crash-safety-review.md) | #7 (closed) | All 16 findings fixed in #15 |
| 2026-09-13 | [Renderer UI + a11y + i18n](2026-09-13-renderer-ui-a11y-i18n-review.md) | #8 (closed) | Fixed in #13/#14; HUD keyboard + translation backlog deferred |

Remediation status docs:

| Date | Document | Origin |
|------|----------|--------|
| 2026-09-16 | [Main-process security remediation](2026-09-16-main-process-security-remediation.md) | PR #23 — per-finding disposition, M3 external dependency, accepted residuals |

Open items carried forward (tracked in docs, not on branches): **M3** code-signing certificate for Windows update Authenticode anchor (see RELEASING.md); native-layer **L2** busy/custom cursor mapping; extension main-world isolation as an architectural follow-up.
