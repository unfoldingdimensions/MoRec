# Handoff Report: Requirement 2 (R2) — Reliable Tray "Stop Recording" Target Routing

## 1. Observation
1. **Tray Menu Implementation**:
   In `electron/main.ts:760-766`, the "Stop Recording" tray menu click handler directly uses the `mainWindow` reference:
   ```ts
   {
       label: "Stop Recording",
       click: () => {
           if (mainWindow && !mainWindow.isDestroyed()) {
               mainWindow.webContents.send("stop-recording-from-tray");
           }
       },
   }
   ```
2. **`mainWindow` Reassignment & Invalidation in `createEditorWindowWrapper`**:
   In `electron/main.ts:815-845`:
   - When the editor opens, `mainWindow` is assigned to `editorWindow` (`main.ts:835`).
   - When the editor window closes, `mainWindow` is set to `null` (`main.ts:840`):
     ```ts
     editorWindow.on("closed", () => {
         if (mainWindow === editorWindow) {
             mainWindow = null;
         }
         ...
     });
     ```
   - The HUD overlay window (`hudOverlayWindow`), created in `electron/windows.ts:453` and tracked via `getHudOverlayWindow()` (`windows.ts:616`), remains alive (hidden in the background via `previousWindow.hide()` at `main.ts:824`).
3. **Tray "Open" and "Show Controls" Desynchronization**:
   In `electron/main.ts:753-757` & `main.ts:771-775`:
   ```ts
   click: () => {
       if (!showHudOverlayFromTray()) {
           focusOrCreateMainWindow();
       }
   }
   ```
   `showHudOverlayFromTray()` (`main.ts:257-278`) unhides the HUD overlay window and returns `true`, completely bypassing `focusOrCreateMainWindow()`. As a result, `mainWindow` is never restored to reference `hudOverlayWindow` and remains `null` or points to the closed editor.
4. **Renderer Event Subscription**:
   In `src/hooks/useScreenRecorder.ts:1289-1293`, `window.electronAPI.onStopRecordingFromTray` is registered only inside `useScreenRecorder()` in the HUD overlay window (`windowType=hud-overlay` in `src/App.tsx:60-66`). The editor window (`windowType=editor` in `src/App.tsx:73-79`) does not subscribe to this event.
5. **Full Test Suite Status**:
   Ran `npm test`. Result: 107 test files passed, 1005 tests passed, 1 skipped.

---

## 2. Logic Chain
1. **Observation 1 & 2** establish that the tray "Stop Recording" menu item dispatches the `stop-recording-from-tray` IPC message solely to `mainWindow.webContents`.
2. **Observation 2 & 3** prove that whenever an editor window is opened and subsequently closed, `mainWindow` becomes `null`. If the HUD overlay is re-shown from the tray, `showHudOverlayFromTray()` does not update `mainWindow`, leaving `mainWindow` as `null`.
3. Consequently, when a new recording is started and the user clicks "Stop Recording" in the system tray, the condition `if (mainWindow && !mainWindow.isDestroyed())` evaluates to `false`, silently dropping the stop event.
4. Furthermore, by **Observation 2 & 4**, if an editor window remains open or minimized while recording, `mainWindow` points to `editorWindow`. The stop message is sent to `editorWindow.webContents`, where no listener exists, while the HUD overlay capture window receives nothing.
5. Therefore, routing tray stop actions via the mutable `mainWindow` variable is fundamentally flawed. Decoupling the tray stop action to target `getHudOverlayWindow()` directly (with multi-window and broadcast fallbacks) guarantees that the active HUD overlay window reliably receives the stop command under all window lifecycle conditions.

---

## 3. Caveats
- No caveats on core Electron main process behavior or window lifecycle.
- Note on multi-platform behavior: On Windows (`win32`), HUD overlay uses `showInactive()` and `reassertHudOverlayMouseState()` when passthrough is active; our routing dispatch must send the IPC command directly via `webContents.send` without forcing inappropriate focus changes that would break Windows mouse passthrough.

---

## 4. Conclusion
The defect in Requirement 2 (R2) is fully identified and isolated to the fragile reliance on `mainWindow` in `electron/main.ts:762-764`.

**Actionable Fix Plan**:
1. Implement `dispatchStopRecordingFromTray()` (either in `electron/windows.ts` or as a helper in `electron/main.ts`):
   - Primary: Send `stop-recording-from-tray` to `getHudOverlayWindow().webContents`.
   - Secondary: Find any window in `BrowserWindow.getAllWindows()` where `webContents.getURL().includes("windowType=hud-overlay")`.
   - Fallback: Broadcast `stop-recording-from-tray` to all live `BrowserWindow` instances.
2. In `electron/main.ts:760-766`, replace `mainWindow.webContents.send("stop-recording-from-tray")` with `dispatchStopRecordingFromTray()`.
3. In `electron/main.ts:1036-1038`, update post-recording window restoration to safely fallback to `getHudOverlayWindow()` when `mainWindow` is `null`.
4. Add unit test coverage in `electron/trayRouting.test.ts` (or `windows.test.ts`) and hook tests in `useScreenRecorder.test.ts`.

---

## 5. Verification Method
1. **Independent Code Inspection**:
   - Inspect `electron/main.ts` lines 760-766, 815-845, and `electron/windows.ts` lines 453-620.
   - Trace `useScreenRecorder.ts` lines 1286-1294 to verify the event subscription channel.
2. **Automated Test Execution**:
   - Run `npm test` to verify zero regressions across all test suites.
   - Run newly added test target: `npx vitest run electron/trayRouting.test.ts` (or equivalent test file for R2).
3. **Invalidation Conditions**:
   - If closing an editor window prevents the tray "Stop Recording" menu item from terminating an active recording session, the fix has failed.
   - If having an editor window open simultaneously with an active HUD recording routes the stop signal to the editor rather than the HUD, the fix has failed.
