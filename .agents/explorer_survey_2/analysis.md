# Requirement 2 (R2) Investigation & Analysis: Reliable Tray "Stop Recording" Target Routing

## Executive Summary
The system tray "Stop Recording" menu item fails whenever an editor window has been opened, closed, minimized, or destroyed because tray action dispatch strictly targets a mutable, overloaded `mainWindow` variable in `electron/main.ts:762-764`. Replacing this fragile reference with a dedicated capture window target resolver (prioritizing `getHudOverlayWindow()` and falling back to capture-window discovery / broadcast) completely decouples tray routing from editor window lifecycle states.

---

## 1. Architecture & Window Lifecycle Analysis

### 1.1 Window Model in MoRec
MoRec operates with multiple distinct `BrowserWindow` instances managed in `electron/windows.ts` and `electron/main.ts`:

| Window Type | Creator Function | URL Query | Characteristics | Renderer Component |
|---|---|---|---|---|
| **HUD Overlay Window** | `createHudOverlayWindow()` (`windows.ts:453`) | `?windowType=hud-overlay` | Transparent, frameless, `alwaysOnTop: true`, `skipTaskbar: true`. Contains the recording controls. | `<LaunchWindow />` + `useScreenRecorder()` |
| **Editor Window** | `createEditorWindow()` (`windows.ts:848`) | `?windowType=editor` | Standard window with chrome, resizable, `skipTaskbar: false`. Mounts after recording finalization. | `<VideoEditor />` |
| **Source Selector** | `createSourceSelectorWindow()` (`windows.ts:934`) | `?windowType=source-selector` | Frameless modal dialog for selecting screen/window sources. | `<SourceSelector />` |
| **Countdown Window** | `createCountdownWindow()` (`windows.ts:979`) | `?windowType=countdown` | Frameless countdown display before recording starts. | `<CountdownOverlay />` |
| **Update Toast** | `createUpdateToastWindow()` (`windows.ts:666`) | `?windowType=update-toast` | Toast notification window for updater events. | `<UpdateToastWindow />` |

### 1.2 Window Management in `electron/main.ts`
In `electron/main.ts`, a single top-level variable is declared:
```ts
// electron/main.ts:172
let mainWindow: BrowserWindow | null = null;
```

This single variable is assigned in two conflicting ways:
1. **At Startup / HUD creation (`electron/main.ts:311-315`)**:
   ```ts
   const createdHudWindow = createHudOverlayWindow();
   mainWindow = createdHudWindow;
   createdHudWindow.once("closed", () => {
       if (mainWindow === createdHudWindow) {
           mainWindow = null;
       }
   });
   ```
2. **When Editor Opens (`electron/main.ts:815-845`)**:
   ```ts
   const previousWindow = mainWindow;
   if (previousWindow && !previousWindow.isDestroyed()) {
       const closingEditorWindow = isEditorWindow(previousWindow);
       if (closingEditorWindow) {
           closeEditorWindowBypassingUnsavedPrompt(previousWindow);
       } else {
           previousWindow.hide(); // Hides HUD window, keeps it alive
       }
       if (mainWindow === previousWindow) {
           mainWindow = null;
       }
   }
   const editorWindow = createEditorWindow();
   mainWindow = editorWindow; // Overwrites mainWindow with editor
   editorWindow.on("closed", () => {
       if (mainWindow === editorWindow) {
           mainWindow = null; // Sets mainWindow to null when editor closes!
       }
       ...
   });
   ```

### 1.3 Tray Menu Architecture & IPC Path
The tray context menu is updated dynamically in `electron/main.ts:745-791`:
```ts
function updateTrayMenu(recording: boolean = false) {
    if (!tray) return;
    const trayIcon = recording ? getRecordingTrayIcon() : getDefaultTrayIcon();
    const trayToolTip = recording ? `Recording: ${selectedSourceName}` : "Mo Rec";
    const menuTemplate = recording
        ? [
                {
                    label: "Show Controls",
                    click: () => {
                        if (!showHudOverlayFromTray()) {
                            focusOrCreateMainWindow();
                        }
                    },
                },
                {
                    label: "Stop Recording",
                    click: () => {
                        if (mainWindow && !mainWindow.isDestroyed()) {
                            mainWindow.webContents.send("stop-recording-from-tray");
                        }
                    },
                },
            ]
        : [ ... ];
    const menu = Menu.buildFromTemplate(menuTemplate);
    trayContextMenu = menu;
    tray.setImage(trayIcon);
    tray.setToolTip(trayToolTip);
    if (process.platform !== "win32") {
        tray.setContextMenu(menu);
    }
}
```

In `electron/preload.ts:593-597`:
```ts
onStopRecordingFromTray: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on("stop-recording-from-tray", listener);
    return () => ipcRenderer.removeListener("stop-recording-from-tray", listener);
},
```

In `src/hooks/useScreenRecorder.ts:1289-1293`:
```ts
useEffect(() => {
    let cleanup: (() => void) | undefined;

    if (window.electronAPI?.onStopRecordingFromTray) {
        cleanup = window.electronAPI.onStopRecordingFromTray(() => {
            stopRecording.current();
        });
    }
    ...
}, []);
```

---

## 2. Root Cause Analysis: How & Why `mainWindow` Fails

### Root Cause 1: `mainWindow` set to `null` on Editor Close
1. A user finishes a recording session -> Editor opens.
2. `mainWindow` points to `editorWindow`. The HUD overlay window was hidden (`previousWindow.hide()`), not destroyed.
3. User closes the Editor window.
4. `editorWindow.on("closed")` executes: `mainWindow = null` (`main.ts:840`).
5. User shows the HUD overlay again (via tray "Open", "Show Controls", or keyboard shortcut) and starts a new recording.
6. User clicks "Stop Recording" in the system tray menu.
7. `updateTrayMenu` checks `if (mainWindow && !mainWindow.isDestroyed())` (`main.ts:762`).
8. `mainWindow` is `null`. The `stop-recording-from-tray` IPC message is never sent. **The recording cannot be stopped from tray.**

### Root Cause 2: `mainWindow` Points to the Editor Window During Recording
1. An editor window is open (or minimized in background).
2. A recording is initiated in the HUD overlay capture window.
3. `mainWindow` holds the reference to the `editorWindow`.
4. User clicks "Stop Recording" in tray.
5. `mainWindow.webContents.send("stop-recording-from-tray")` dispatches IPC to `editorWindow.webContents`.
6. The editor window renderer does not listen to `stop-recording-from-tray` (only `useScreenRecorder` in `<LaunchWindow />` does).
7. The HUD overlay window never receives the event.

### Root Cause 3: Desynchronization in `showHudOverlayFromTray()`
1. In `updateTrayMenu`, the "Open" and "Show Controls" menu items call:
   ```ts
   if (!showHudOverlayFromTray()) {
       focusOrCreateMainWindow();
   }
   ```
2. `showHudOverlayFromTray()` (`main.ts:257-278`) accesses `getHudOverlayWindow()` directly, restores it, and returns `true`.
3. Because `showHudOverlayFromTray()` succeeds and returns `true`, `focusOrCreateMainWindow()` is skipped.
4. `mainWindow` is **never restored** to point to the HUD overlay window; it remains `null` or points to whatever obsolete window it previously held.

### Root Cause 4: Discrepancy with Other IPC Event Broadcasting
All other recording-related IPC events in the codebase (`recording-interrupted`, `recording-state-changed`, `recording-session-changed`) safely broadcast across all active `BrowserWindow.getAllWindows()`:
- `electron/ipc/recording/events.ts:4-8`:
  ```ts
  BrowserWindow.getAllWindows().forEach((window) => {
      if (!window.isDestroyed()) {
          window.webContents.send("recording-interrupted", { reason, message });
      }
  });
  ```
- `electron/ipc/register/recording.ts:1849-1856`:
  ```ts
  BrowserWindow.getAllWindows().forEach((window) => {
      if (!window.isDestroyed()) {
          window.webContents.send("recording-state-changed", { recording, sourceName });
      }
  });
  ```
Only `stop-recording-from-tray` was tied to the single, mutable `mainWindow` variable.

---

## 3. Vulnerable IPC Dispatch & Tray Action Locations

| Location | Code Pattern | Issue | Recommended Target |
|---|---|---|---|
| `electron/main.ts:762-764` | `mainWindow.webContents.send("stop-recording-from-tray")` | Sends stop signal only to `mainWindow` (often `null` or `editorWindow`). | Active HUD Window via `getHudOverlayWindow()` + Fallback broadcast |
| `electron/main.ts:1036-1038` | `if (!recording) { restoreWindowSafely(mainWindow); }` | If `mainWindow` is `null`, HUD window is not restored after recording stops. | `restoreWindowSafely(mainWindow ?? getHudOverlayWindow())` |
| `electron/main.ts:385-390` | `sendEditorMenuAction` (`BrowserWindow.getFocusedWindow() ?? mainWindow`) | Falls back to `mainWindow` which may be HUD. | Check `isEditorWindow` before sending editor actions |
| `electron/main.ts:698-702` | `getUpdateDialogWindow` | Handled properly: checks focused -> `mainWindow` -> `getHudOverlayWindow()`. | (Already robust) |

---

## 4. Recommended Fix Strategy for R2

### 4.1 Create a Dedicated Capture Target Dispatcher
Define a reliable helper function `dispatchStopRecordingToCaptureWindow()` (or `dispatchStopRecordingFromTray()`) in `electron/windows.ts` or `electron/trayRouting.ts`:

```ts
/**
 * Reliably dispatches the 'stop-recording-from-tray' IPC message to the active HUD overlay
 * capture window, regardless of editor window states or mutable mainWindow references.
 */
export function dispatchStopRecordingFromTray(): boolean {
    // 1. Primary Target: The registered HUD overlay window
    const hudWindow = getHudOverlayWindow();
    if (hudWindow && !hudWindow.isDestroyed()) {
        hudWindow.webContents.send("stop-recording-from-tray");
        return true;
    }

    // 2. Secondary Target: Scan all open windows for a HUD overlay / capture window
    let dispatched = false;
    const allWindows = BrowserWindow.getAllWindows();
    for (const win of allWindows) {
        if (!win.isDestroyed()) {
            const url = win.webContents.getURL();
            if (url.includes("windowType=hud-overlay")) {
                win.webContents.send("stop-recording-from-tray");
                dispatched = true;
            }
        }
    }

    if (dispatched) {
        return true;
    }

    // 3. Fallback: Broadcast to all non-destroyed windows to guarantee the active recorder receives it
    for (const win of allWindows) {
        if (!win.isDestroyed()) {
            win.webContents.send("stop-recording-from-tray");
            dispatched = true;
        }
    }

    return dispatched;
}
```

### 4.2 Update `updateTrayMenu` in `electron/main.ts`
Replace the flawed handler in `updateTrayMenu`:
```ts
// Before (electron/main.ts:760-766):
{
    label: "Stop Recording",
    click: () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send("stop-recording-from-tray");
        }
    },
}

// After:
{
    label: "Stop Recording",
    click: () => {
        dispatchStopRecordingFromTray();
    },
}
```

### 4.3 Clean Up Post-Recording Window Restoration
In `electron/main.ts:1036-1038`:
```ts
// Before:
if (!recording) {
    restoreWindowSafely(mainWindow);
}

// After:
if (!recording) {
    const target = (mainWindow && !mainWindow.isDestroyed()) ? mainWindow : getHudOverlayWindow();
    restoreWindowSafely(target);
}
```

---

## 5. Testing & Verification Approach for R2

### 5.1 Unit Tests for Tray Routing Target Resolution
Create `electron/trayRouting.test.ts` (using Vitest) to test all permutations:
1. **Targeting active HUD overlay window**: When `hudOverlayWindow` is present, it receives `stop-recording-from-tray`.
2. **Editor window isolation**: When both an `editorWindow` and a `hudOverlayWindow` exist, `stop-recording-from-tray` is sent to the HUD window, not the editor window.
3. **Null/Destroyed `mainWindow` recovery**: When `mainWindow` is `null` or destroyed, `dispatchStopRecordingFromTray()` successfully targets `getHudOverlayWindow()`.
4. **Fallback scan**: When `hudOverlayWindow` module variable is `null`, `dispatchStopRecordingFromTray()` scans `BrowserWindow.getAllWindows()` and finds the window whose URL contains `windowType=hud-overlay`.
5. **Universal broadcast fallback**: When no HUD URL matches, dispatches to all live windows.

### 5.2 Unit Tests for Renderer Tray Listener in `useScreenRecorder.test.ts`
Add tests verifying:
1. The hook registers `window.electronAPI.onStopRecordingFromTray` on mount.
2. Triggering the tray callback invokes `stopRecording.current()`.
3. Unmounting cleanly removes the listener.

### 5.3 Regression Testing
Run `npm test` to verify all 107 test files and 1005+ tests continue passing with 0 regressions.
