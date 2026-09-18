import type { ClipRegion } from "../types";

/**
 * Silence-driven suggestions on the source timeline (mirror of
 * zoomSuggestionUtils.ts): one consumer turns ffmpeg `silencedetect` intervals
 * into trim spans ("Remove dead air"), another into 2× speed regions ("Speed up
 * dead air"). All spans are source-time milliseconds; reservation against
 * existing zoom/speed regions and the removal-ratio guard keep one click from
 * gutting a recording.
 */

export interface SilenceSpanInput {
	startMs: number;
	endMs: number;
}

export interface SuggestedSpan {
	startMs: number;
	endMs: number;
}

export const DEFAULT_TRIM_MIN_SILENCE_MS = 700;
export const DEFAULT_TRIM_PAD_MS = 120;
export const DEFAULT_TRIM_MERGE_GAP_MS = 400;
export const DEFAULT_TRIM_MAX_REMOVAL_RATIO = 0.45;
/** Dead-air speed-up only considers silences longer than the trim threshold. */
export const DEFAULT_DEAD_AIR_MIN_SILENCE_MS = 1200;
export const DEFAULT_DEAD_AIR_SPEED = 2;

export type SilenceSuggestionStatus = "ok" | "no-silence" | "too-much-silence";

export interface SilenceSuggestionResult {
	status: SilenceSuggestionStatus;
	suggestions: SuggestedSpan[];
}

function isFinitePositiveSpan(span: SilenceSpanInput): span is SuggestedSpan {
	return (
		Number.isFinite(span.startMs) &&
		Number.isFinite(span.endMs) &&
		span.endMs > span.startMs
	);
}

/** Clamp, sort, and merge overlapping raw intervals into a clean span list. */
function normalizeIntervals(intervals: SilenceSpanInput[], totalMs: number): SuggestedSpan[] {
	const bounded = intervals
		.filter(isFinitePositiveSpan)
		.map((span) => ({
			startMs: Math.max(0, span.startMs),
			endMs: Math.min(totalMs, span.endMs),
		}))
		.filter((span) => span.endMs > span.startMs)
		.sort((left, right) => left.startMs - right.startMs || left.endMs - right.endMs);

	const merged: SuggestedSpan[] = [];
	for (const span of bounded) {
		const previous = merged[merged.length - 1];
		if (previous && span.startMs <= previous.endMs) {
			previous.endMs = Math.max(previous.endMs, span.endMs);
			continue;
		}
		merged.push({ ...span });
	}
	return merged;
}

/** Merge spans separated by no more than `mergeGapMs`. */
function mergeSpansByGap(spans: SuggestedSpan[], mergeGapMs: number): SuggestedSpan[] {
	if (spans.length <= 1 || mergeGapMs < 0) {
		return spans.map((span) => ({ ...span }));
	}

	const merged: SuggestedSpan[] = [];
	for (const span of spans) {
		const previous = merged[merged.length - 1];
		if (previous && span.startMs - previous.endMs <= mergeGapMs) {
			previous.endMs = Math.max(previous.endMs, span.endMs);
			continue;
		}
		merged.push({ ...span });
	}
	return merged;
}

/**
 * Keep `padMs` of breathing room at each edge of a candidate span so cuts and
 * speed ramps don't start mid-syllable. Padding never grows a span past zero.
 */
function shrinkSpanEdges(spans: SuggestedSpan[], padMs: number): SuggestedSpan[] {
	if (padMs <= 0) {
		return spans.map((span) => ({ ...span }));
	}
	return spans
		.map((span) => ({
			startMs: span.startMs + padMs,
			endMs: span.endMs - padMs,
		}))
		.filter((span) => span.endMs > span.startMs);
}

function spansOverlap(
	left: SuggestedSpan,
	right: SuggestedSpan,
): boolean {
	return left.startMs < right.endMs && left.endMs > right.startMs;
}

/**
 * Drop candidate spans that touch a reserved span, expanded by `padMs` on both
 * sides — the "never trim inside or adjacent to a zoom/speed region" guard.
 */
function excludeReserved(
	spans: SuggestedSpan[],
	reservedSpans: SuggestedSpan[],
	padMs: number,
): SuggestedSpan[] {
	if (reservedSpans.length === 0) {
		return spans;
	}

	const paddedReserved = reservedSpans.map((span) => ({
		startMs: span.startMs - padMs,
		endMs: span.endMs + padMs,
	}));

	return spans.filter(
		(span) => !paddedReserved.some((reserved) => spansOverlap(span, reserved)),
	);
}

function subtractSpans(from: SuggestedSpan, cuts: SuggestedSpan[]): SuggestedSpan[] {
	const pieces: SuggestedSpan[] = [];
	let cursor = from.startMs;

	for (const cut of cuts) {
		if (cut.endMs <= cursor || cut.startMs >= from.endMs) {
			continue;
		}
		const clippedStart = Math.max(cut.startMs, cursor);
		if (clippedStart > cursor) {
			pieces.push({ startMs: cursor, endMs: clippedStart });
		}
		cursor = Math.max(cursor, Math.min(cut.endMs, from.endMs));
	}

	if (cursor < from.endMs) {
		pieces.push({ startMs: cursor, endMs: from.endMs });
	}
	return pieces;
}

interface BuildSilenceSuggestionsParams {
	/** ffmpeg `silencedetect` intervals (source time). */
	intervals: SilenceSpanInput[];
	/** Total source duration in milliseconds. */
	totalMs: number;
	/** Existing zoom/speed regions (source time) the suggestions must not touch. */
	reservedSpans?: SuggestedSpan[];
	minSilenceMs?: number;
	padMs?: number;
	mergeGapMs?: number;
}

function buildSilenceCandidateSpans(params: BuildSilenceSuggestionsParams): {
	candidates: SuggestedSpan[];
} {
	const {
		intervals,
		totalMs,
		reservedSpans = [],
		minSilenceMs,
		padMs = 0,
		mergeGapMs = 0,
	} = params;

	if (!Number.isFinite(totalMs) || totalMs <= 0) {
		return { candidates: [] };
	}

	const normalized = normalizeIntervals(intervals, totalMs).filter(
		(span) => span.endMs - span.startMs >= (minSilenceMs ?? 0),
	);

	const merged = mergeSpansByGap(normalized, mergeGapMs);
	const shrunk = shrinkSpanEdges(merged, padMs);
	const candidates = excludeReserved(shrunk, reservedSpans, padMs);
	return { candidates };
}

/**
 * Feature 2: turn detected silences into the spans to cut. Returns
 * `too-much-silence` (and no suggestions) when the cut would remove more than
 * `maxRemovalRatio` of the recording.
 */
export function buildSilenceTrimSuggestions(
	params: BuildSilenceSuggestionsParams & {
		maxRemovalRatio?: number;
	},
): SilenceSuggestionResult {
	const {
		totalMs,
		minSilenceMs = DEFAULT_TRIM_MIN_SILENCE_MS,
		padMs = DEFAULT_TRIM_PAD_MS,
		mergeGapMs = DEFAULT_TRIM_MERGE_GAP_MS,
		maxRemovalRatio = DEFAULT_TRIM_MAX_REMOVAL_RATIO,
	} = params;

	const { candidates } = buildSilenceCandidateSpans({
		...params,
		minSilenceMs,
		padMs,
		mergeGapMs,
	});

	if (candidates.length === 0) {
		return { status: "no-silence", suggestions: [] };
	}

	const totalRemovalMs = candidates.reduce((sum, span) => sum + (span.endMs - span.startMs), 0);
	if (totalRemovalMs > totalMs * maxRemovalRatio) {
		return { status: "too-much-silence", suggestions: [] };
	}

	return { status: "ok", suggestions: candidates };
}

/**
 * Feature 3 source A: long silences become 2× speed regions. `trimmedSpans`
 * (Feature 2's cuts, if any) take precedence — a span already trimmed is not
 * also sped up; each candidate keeps only its untrimmed remainder.
 */
export function buildDeadAirSpeedSuggestions(
	params: BuildSilenceSuggestionsParams & {
		/** Silence already removed by trim regions (source time). */
		trimmedSpans?: SuggestedSpan[];
	},
): SilenceSuggestionResult {
	const {
		minSilenceMs = DEFAULT_DEAD_AIR_MIN_SILENCE_MS,
		padMs = 0,
		mergeGapMs = 0,
		trimmedSpans = [],
	} = params;

	const reservedSpans = params.reservedSpans ?? [];
	const { candidates } = buildSilenceCandidateSpans({
		...params,
		minSilenceMs,
		padMs,
		mergeGapMs,
	});

	if (candidates.length === 0) {
		return { status: "no-silence", suggestions: [] };
	}

	const sortedCuts = [...trimmedSpans].sort((left, right) => left.startMs - right.startMs);
	const untrimmed = candidates.flatMap((candidate) => subtractSpans(candidate, sortedCuts));

	const suggestions = excludeReserved(untrimmed, reservedSpans, padMs).filter(
		(span) => span.endMs - span.startMs >= minSilenceMs,
	);

	if (suggestions.length === 0) {
		return { status: "no-silence", suggestions: [] };
	}

	return { status: "ok", suggestions };
}

export interface ClipSegment extends Pick<ClipRegion, "speed"> {
	startMs: number;
	endMs: number;
	muted?: boolean;
	showSourceAudio?: boolean;
}

export interface SilenceTrimApplication {
	/** Kept clip pieces with the suggestion spans removed (ids assigned by the caller). */
	clipSegments: ClipSegment[];
	/**
	 * The parts of the suggestion spans that actually cut kept clip content —
	 * candidates falling inside existing trims remove nothing and are excluded,
	 * so callers only drop regions that overlap real cuts.
	 */
	removedSpans: SuggestedSpan[];
}

/**
 * Apply trim suggestions to the clip model: every clip is split around each
 * suggestion span (spans are source-time, like the clips themselves). Clips
 * with a custom speed keep it; pieces shorter than 1ms are dropped.
 */
export function planSilenceTrimApplication(
	clips: ClipRegion[],
	suggestions: SuggestedSpan[],
): SilenceTrimApplication {
	const cuts = [...suggestions].sort((left, right) => left.startMs - right.startMs);
	const clipSegments: ClipSegment[] = [];
	const removedSpans: SuggestedSpan[] = [];

	for (const clip of clips) {
		const clipSpan: SuggestedSpan = { startMs: clip.startMs, endMs: clip.endMs };
		const pieces = subtractSpans(clipSpan, cuts);
		for (const piece of pieces) {
			clipSegments.push(toSegment(clip, piece));
		}
	}

	// What actually got cut: the cuts clipped to kept clip coverage, merged so
	// two clips covering the same cut report one removal.
	const clipped = clips.flatMap((clip) =>
		cuts.map((cut) => ({
			startMs: Math.max(cut.startMs, clip.startMs),
			endMs: Math.min(cut.endMs, clip.endMs),
		})),
	);
	for (const span of clipped.sort(
		(left, right) => left.startMs - right.startMs || left.endMs - right.endMs,
	)) {
		if (span.endMs <= span.startMs) {
			continue;
		}
		const previous = removedSpans[removedSpans.length - 1];
		if (previous && span.startMs <= previous.endMs) {
			previous.endMs = Math.max(previous.endMs, span.endMs);
			continue;
		}
		removedSpans.push(span);
	}

	return { clipSegments, removedSpans };
}

function toSegment(clip: ClipRegion, span: SuggestedSpan): ClipSegment {
	return {
		startMs: span.startMs,
		endMs: span.endMs,
		speed: clip.speed,
		...(clip.muted !== undefined ? { muted: clip.muted } : {}),
		...(clip.showSourceAudio !== undefined ? { showSourceAudio: clip.showSourceAudio } : {}),
	};
}
