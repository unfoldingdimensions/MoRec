## 2026-08-19T03:06:41Z
You are Worker 2 for Milestone 2 (R2 - Reliable Tray "Stop Recording" Target Routing).
Your working directory is e:/New-Personal-Projects/MoRec/.agents/worker_m2.

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

First, read:
1. e:/New-Personal-Projects/MoRec/ORIGINAL_REQUEST.md
2. e:/New-Personal-Projects/MoRec/PROJECT.md
3. e:/New-Personal-Projects/MoRec/.agents/explorer_survey_2/analysis.md
4. e:/New-Personal-Projects/MoRec/.agents/explorer_survey_2/handoff.md

Scope of changes (Exclusive write ownership):
- `electron/windows.ts` / `electron/main.ts`:
  1. Implement `dispatchStopRecordingFromTray()`:
     - Check `getHudOverlayWindow()`: if alive and not destroyed, send `stop-recording-from-tray` to its webContents.
     - Fallback: Scan `BrowserWindow.getAllWindows()` for any window matching capture/HUD overlay (`windowType=hud-overlay` in URL).
     - Fallback: Broadcast `stop-recording-from-tray` to all live BrowserWindow instances.
  2. In `electron/main.ts` (lines ~760-766), replace the direct `mainWindow.webContents.send("stop-recording-from-tray")` with `dispatchStopRecordingFromTray()`.
  3. Ensure post-recording window restoration in `electron/main.ts` (lines ~1036-1038) safely falls back to `getHudOverlayWindow()` when `mainWindow` is null or destroyed.
- `electron/trayRouting.test.ts` (or `electron/windows.test.ts`):
  Create/update comprehensive tests verifying:
  - Stop dispatch successfully reaches the HUD overlay window when `mainWindow` is null (e.g. after editor window was closed).
  - Stop dispatch successfully reaches the HUD overlay window when `mainWindow` references an editor window.
  - Fallback window discovery via `BrowserWindow.getAllWindows()` and broadcast behavior.

Verification:
- Run tests: `npx vitest run electron/trayRouting.test.ts` (or relevant test) and ensure full `npm test` passes without regressions.
- Ensure `npx tsc --noEmit` has 0 errors.
- Document all changes and test outputs in `e:/New-Personal-Projects/MoRec/.agents/worker_m2/handoff.md`.
- Send a message when done.
