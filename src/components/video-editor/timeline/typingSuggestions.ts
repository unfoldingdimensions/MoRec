import type { CursorTelemetryPoint } from "../types";
import type { SuggestedSpan } from "./silenceSuggestions";

/**
 * Keyboard-driven speed suggestions (Feature 3 source B): typing bursts in the
 * cursor telemetry (uiohook keydown events, `interactionType: "key"`) become
 * 2× speed regions. Only key *timestamps* are used — no key content is stored
 * anywhere in the telemetry.
 */

export const MIN_TYPING_KEYS_PER_WINDOW = 3;
/** Consecutive keys within this gap belong to the same burst. */
export const TYPING_WINDOW_MS = 2000;
/** A burst shorter than this reads as a stray shortcut, not typing. */
export const MIN_TYPING_BURST_DURATION_MS = 1500;
export const TYPING_PAD_MS = 250;
export const TYPING_MERGE_GAP_MS = 500;
/** Cap total accelerated duration at this fraction of the recording. */
export const MAX_TYPING_SPEEDUP_RATIO = 0.4;
export const DEFAULT_TYPING_SPEED = 2;

export type TypingSuggestionStatus = "ok" | "no-keys" | "no-bursts";

export interface TypingSuggestionResult {
	status: TypingSuggestionStatus;
	suggestions: SuggestedSpan[];
}

export function extractKeyEventTimesMs(samples: CursorTelemetryPoint[]): number[] {
	return samples
		.filter((sample) => sample.interactionType === "key" && Number.isFinite(sample.timeMs))
		.map((sample) => Math.max(0, sample.timeMs))
		.sort((left, right) => left - right);
}

/**
 * Group key timestamps into bursts: a run of keys where each consecutive gap
 * is at most `windowMs`, with at least `minKeys` keys total.
 */
export function detectTypingBurstsMs(
	keyTimesMs: number[],
	options?: { windowMs?: number; minKeys?: number },
): SuggestedSpan[] {
	const windowMs = options?.windowMs ?? TYPING_WINDOW_MS;
	const minKeys = options?.minKeys ?? MIN_TYPING_KEYS_PER_WINDOW;

	if (keyTimesMs.length < minKeys || minKeys < 1) {
		return [];
	}

	const bursts: SuggestedSpan[] = [];
	let startMs = keyTimesMs[0];
	let lastMs = keyTimesMs[0];
	let count = 1;

	const flush = () => {
		if (count >= minKeys) {
			bursts.push({ startMs, endMs: lastMs });
		}
	};

	for (let index = 1; index < keyTimesMs.length; index += 1) {
		const timeMs = keyTimesMs[index];
		if (timeMs - lastMs <= windowMs) {
			lastMs = timeMs;
			count += 1;
			continue;
		}

		flush();
		startMs = timeMs;
		lastMs = timeMs;
		count = 1;
	}
	flush();

	return bursts;
}

function spansOverlap(left: SuggestedSpan, right: SuggestedSpan): boolean {
	return left.startMs < right.endMs && left.endMs > right.startMs;
}

/**
 * Build typed-section speed suggestions from cursor telemetry key events.
 * Bursts are padded ±`padMs`, merged when padding makes them touch, reserved
 * against existing zoom/speed regions, and capped so the accelerated total
 * stays within `maxSpeedupRatio` of the recording (longest bursts win).
 */
export function buildTypingSpeedSuggestions(params: {
	cursorTelemetry: CursorTelemetryPoint[];
	totalMs: number;
	/** Existing zoom/speed regions (source time) the suggestions must not touch. */
	reservedSpans?: SuggestedSpan[];
	minBurstDurationMs?: number;
	padMs?: number;
	mergeGapMs?: number;
	maxSpeedupRatio?: number;
}): TypingSuggestionResult {
	const {
		cursorTelemetry,
		totalMs,
		reservedSpans = [],
		minBurstDurationMs = MIN_TYPING_BURST_DURATION_MS,
		padMs = TYPING_PAD_MS,
		mergeGapMs = TYPING_MERGE_GAP_MS,
		maxSpeedupRatio = MAX_TYPING_SPEEDUP_RATIO,
	} = params;

	if (!Number.isFinite(totalMs) || totalMs <= 0) {
		return { status: "no-keys", suggestions: [] };
	}

	const keyTimesMs = extractKeyEventTimesMs(cursorTelemetry).filter(
		(timeMs) => timeMs <= totalMs,
	);
	if (keyTimesMs.length === 0) {
		return { status: "no-keys", suggestions: [] };
	}

	const effectiveMinBurstMs = Math.min(minBurstDurationMs, totalMs);
	const padded = detectTypingBurstsMs(keyTimesMs)
		.map((burst) => ({
			startMs: Math.max(0, burst.startMs - padMs),
			endMs: Math.min(totalMs, burst.endMs + padMs),
		}))
		.filter((burst) => burst.endMs - burst.startMs >= effectiveMinBurstMs);

	const merged: SuggestedSpan[] = [];
	for (const burst of padded) {
		const previous = merged[merged.length - 1];
		if (previous && burst.startMs - previous.endMs <= mergeGapMs) {
			previous.endMs = Math.max(previous.endMs, burst.endMs);
			continue;
		}
		merged.push({ ...burst });
	}

	const available = merged.filter(
		(span) => !reservedSpans.some((reservedSpan) => spansOverlap(span, reservedSpan)),
	);
	if (available.length === 0) {
		return { status: "no-bursts", suggestions: [] };
	}

	const capMs = totalMs * maxSpeedupRatio;
	const kept: SuggestedSpan[] = [];
	let acceleratedMs = 0;
	for (const span of [...available].sort(
		(left, right) => right.endMs - right.startMs - (left.endMs - left.startMs),
	)) {
		const durationMs = span.endMs - span.startMs;
		if (acceleratedMs + durationMs > capMs) {
			continue;
		}
		kept.push(span);
		acceleratedMs += durationMs;
	}

	if (kept.length === 0) {
		return { status: "no-bursts", suggestions: [] };
	}

	return {
		status: "ok",
		suggestions: kept.sort((left, right) => left.startMs - right.startMs),
	};
}
