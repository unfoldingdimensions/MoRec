# Audit & Review Reports

Findings-only review reports for MoRec. Each report names file:line and severity; the status header at the top of each file says whether and how the findings landed. Convention: fix PRs that close audit findings update the matching report's status line in the same PR.

| Date | Report | Review PR | Status |
|------|--------|-----------|--------|
| 2026-09-13 | [Recording lifecycle](2026-09-13-recording-lifecycle-review.md) | #1 (merged) | All findings fixed; fixes merged to main |
| 2026-09-13 | [Video editor UI/UX](2026-09-13-video-editor-ux-review.md) | #2 (closed) | All findings fixed in #9 |
| 2026-09-13 | [Persistence & crash safety](2026-09-13-persistence-crash-safety-review.md) | #7 (closed) | All 16 findings fixed in #15 |
| 2026-09-13 | [Renderer UI + a11y + i18n](2026-09-13-renderer-ui-a11y-i18n-review.md) | #8 (closed) | Fixed in #13/#14; HUD keyboard + translation backlog deferred |

Reports not yet consolidated to main (still on their open review PR branches):

| Date | Topic | Review PR | Status |
|------|-------|-----------|--------|
| 2026-09-13 | Audio/captions pipeline | #3 (open) | Fixes in progress in #16 |
| 2026-09-13 | Main-process security | #4 (open) | Findings open (H1–H3, M1–M5) |
| 2026-09-13 | Windows export pipeline | #5 (open) | Findings open (5 High) |
| 2026-09-13 | Windows native layer | #6 (open) | Findings open (H1–H3, M1–M5) |
