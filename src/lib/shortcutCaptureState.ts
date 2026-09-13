/**
 * Tracks whether the shortcuts config dialog is currently capturing a chord.
 *
 * The dialog's capture listener runs on window in the capture phase, but the
 * editor's own window-capture shortcut handler was registered first and
 * therefore fires before it — `stopPropagation`/`stopImmediatePropagation`
 * from the dialog cannot retroactively stop that earlier listener. Handlers
 * that must stay inert while a chord is being captured consult this flag.
 */
let captureActive = false;

export function setShortcutCaptureActive(active: boolean): void {
	captureActive = active;
}

export function isShortcutCaptureActive(): boolean {
	return captureActive;
}
