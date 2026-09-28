/**
 * Multi-clip recording marks (P1 Feature 6) → discardable ranges.
 *
 * A mark means "everything since the previous boundary up to this point was
 * flubbed": marks split the recording into takes, and the take ENDING at each
 * mark is discard-defaulted. The final take (to the recording duration) is
 * kept by default. The editor panel lets the user toggle each take before
 * applying; applying runs the same clip-cut pipeline as silence removal.
 */

export interface MultiClipRange {
	startMs: number;
	endMs: number;
	discard: boolean;
}

/** Defensive re-normalization of marks arriving over IPC (mirrors main). */
export function normalizeMarkList(value: unknown, durationMs?: number): number[] {
	if (!Array.isArray(value)) {
		return [];
	}
	const clampTo = Number.isFinite(durationMs) && (durationMs ?? 0) > 0 ? durationMs! : null;
	const normalized: number[] = [];
	for (const entry of value) {
		if (typeof entry !== "number" || !Number.isFinite(entry)) {
			continue;
		}
		const markMs = Math.round(entry);
		if (markMs < 250) {
			continue;
		}
		if (clampTo !== null && markMs >= clampTo) {
			continue;
		}
		const previous = normalized[normalized.length - 1];
		if (previous !== undefined && markMs - previous < 500) {
			continue;
		}
		normalized.push(markMs);
	}
	return normalized;
}

/**
 * Splits [0, durationMs] at the marks. Returns [] when there are no usable
 * marks or the duration is unknown — nothing to offer, no panel.
 */
export function deriveMultiClipRanges(
	rawMarks: unknown,
	durationMs: number,
): MultiClipRange[] {
	const marks = normalizeMarkList(rawMarks, durationMs);
	if (marks.length === 0 || !Number.isFinite(durationMs) || durationMs <= 0) {
		return [];
	}

	const boundaries = [0, ...marks, Math.round(durationMs)];
	const ranges: MultiClipRange[] = [];
	for (let index = 0; index < boundaries.length - 1; index += 1) {
		const startMs = boundaries[index];
		const endMs = boundaries[index + 1];
		if (endMs - startMs < 250) {
			continue;
		}
		// A take ending at a mark defaults to discard (the mark flagged the
		// flub that just happened); the tail take after the last mark is kept.
		ranges.push({ startMs, endMs, discard: index < marks.length });
	}
	return ranges;
}
