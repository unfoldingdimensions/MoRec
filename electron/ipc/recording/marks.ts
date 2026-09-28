import { isAutoRecordingPath, normalizeVideoSourcePath } from "../utils";

/**
 * Main-process state for HUD "mark segment" timestamps of the recording in
 * flight.
 *
 * Marks are captured with the pause-aware cursor-capture clock and held here
 * until the recording stops and the editor session is set, at which point
 * `consumeRecordingMarksForPath` attaches them to the session so they land in
 * the recording-session manifest. When the recording target path is already
 * known (native capture), the mark handler also persists the manifest
 * per-mark so marks survive a crash before stop.
 */

let marksMs: number[] = [];
let targetVideoPath: string | null = null;

/**
 * Recording start: drop any stale marks and record the output path (null for
 * the browser-capture fallback, where the file only exists after stop).
 */
export function beginRecordingCapture(videoPath: string | null): void {
	marksMs = [];
	targetVideoPath = normalizeVideoSourcePath(videoPath);
}

/** Recording start for flows that only need the stale-mark reset. */
export function resetRecordingMarks(): void {
	marksMs = [];
}

export function getRecordingTargetPath(): string | null {
	return targetVideoPath;
}

/** Appends a mark (ascending, double-tap-safe) and returns the full list. */
export function addRecordingMark(elapsedMs: number): number[] {
	const markMs = Math.round(elapsedMs);
	const previous = marksMs[marksMs.length - 1];
	// Ignore a 0:00 mark and double-taps within 500 ms.
	if (Number.isFinite(markMs) && markMs >= 250 && (previous === undefined || markMs - previous >= 500)) {
		marksMs = [...marksMs, markMs];
	}
	return [...marksMs];
}

export function getRecordingMarks(): number[] {
	return [...marksMs];
}

/**
 * Hands the pending marks to the session being set for `videoPath`, clearing
 * them. A path mismatch keeps the marks pending: they belong to the most
 * recent recording, not to an unrelated file the user happened to open.
 */
export function consumeRecordingMarksForPath(videoPath: string | null | undefined): number[] | null {
	if (marksMs.length === 0) {
		return null;
	}
	const normalized = normalizeVideoSourcePath(videoPath);
	if (!normalized) {
		return null;
	}
	if (targetVideoPath !== null) {
		if (targetVideoPath !== normalized) {
			return null;
		}
	} else if (!isAutoRecordingPath(normalized)) {
		// Browser capture never knows its target; only bless auto-generated
		// recordings so an unrelated import cannot inherit stale marks.
		return null;
	}
	const consumed = [...marksMs];
	marksMs = [];
	targetVideoPath = null;
	return consumed;
}
