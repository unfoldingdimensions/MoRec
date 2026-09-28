import { isAutoRecordingPath, normalizeVideoSourcePath } from "../utils";

/**
 * Main-process state for HUD "mark segment" actions on the recording in
 * flight.
 *
 * Two mark modes share this module:
 * - Timestamps (browser-capture fallback): marks are pause-aware elapsed
 *   times, attached to the session manifest and cut in the editor.
 * - True segments (native capture): each mark rolls the capture over to a
 *   new file. The finalized segment paths accumulate here; the FIRST
 *   segment is the primary recording (its name anchors the manifest and
 *   cursor telemetry, and the concat output overwrites it).
 */

let marksMs: number[] = [];
let targetVideoPath: string | null = null;
let segmentFiles: string[] = [];

/**
 * Recording start: drop stale timestamp marks and record the output path
 * (null for the browser-capture fallback, where the file only exists after
 * stop). Accumulated segment files are preserved — the rollover respawn
 * re-enters the start path mid-recording; a genuinely new recording clears
 * them via resetRecordingMarks.
 */
export function beginRecordingCapture(videoPath: string | null): void {
	marksMs = [];
	targetVideoPath = normalizeVideoSourcePath(videoPath);
}

/** Recording start: clears all multi-clip state (marks and segments). */
export function resetRecordingMarks(): void {
	marksMs = [];
	segmentFiles = [];
}

export function getRecordingTargetPath(): string | null {
	return targetVideoPath;
}

/** Appends a timestamp mark (ascending, double-tap-safe) and returns the full list. */
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

/** True once at least one rollover happened (segment mode is engaged). */
export function isRecordingSegmented(): boolean {
	return segmentFiles.length > 0;
}

/** Records a finalized segment file (the concatenation source order). */
export function addRecordingSegmentFile(filePath: string): string[] {
	const normalized = normalizeVideoSourcePath(filePath);
	if (normalized) {
		segmentFiles = [...segmentFiles, normalized];
	}
	return [...segmentFiles];
}

export function getRecordingSegmentFiles(): string[] {
	return [...segmentFiles];
}

/**
 * The primary recording path: the first segment when segment mode is
 * engaged, otherwise the path the caller already has.
 */
export function getPrimarySegmentPath(fallbackPath: string): string {
	return segmentFiles.length > 0 ? segmentFiles[0] : fallbackPath;
}

/**
 * Hands the pending marks (and segments, when engaged) to the session being
 * set for `videoPath`, clearing them. A path mismatch keeps them pending:
 * they belong to the most recent recording, not to an unrelated file the
 * user happened to open. Segment mode anchors on the primary (first
 * segment) path; timestamp mode anchors on the recording target, falling
 * back to auto-recording paths for the browser capture.
 */
export function consumeRecordingMarksForPath(
	videoPath: string | null | undefined,
): { marksMs: number[]; segmentFiles: string[] } | null {
	if (marksMs.length === 0) {
		return null;
	}
	const normalized = normalizeVideoSourcePath(videoPath);
	if (!normalized) {
		return null;
	}
	if (segmentFiles.length > 0) {
		if (normalized !== segmentFiles[0]) {
			return null;
		}
	} else if (targetVideoPath !== null) {
		if (targetVideoPath !== normalized) {
			return null;
		}
	} else if (!isAutoRecordingPath(normalized)) {
		// Browser capture never knows its target; only bless auto-generated
		// recordings so an unrelated import cannot inherit stale marks.
		return null;
	}
	const consumed = {
		marksMs: [...marksMs],
		segmentFiles: [...segmentFiles],
	};
	marksMs = [];
	segmentFiles = [];
	targetVideoPath = null;
	return consumed;
}
