/**
 * Cursor visibility state tracker for browser recording sessions.
 *
 * Stream-level cursor exclusion is handled natively by Chromium's
 * desktopCapturer constraints (`cursor: 'never'`, `googCaptureCursor: false`).
 * This module maintains recording-time cursor tracking state without executing
 * blocking child processes on the main thread.
 */

let cursorHidden = false;

export function hideCursor(): boolean {
	if (cursorHidden) {
		return false;
	}

	cursorHidden = true;
	return true;
}

export function showCursor(): boolean {
	if (!cursorHidden) {
		return false;
	}

	cursorHidden = false;
	return true;
}

export function isCursorHidden(): boolean {
	return cursorHidden;
}

export function resetCursorHiderState(): void {
	cursorHidden = false;
}

