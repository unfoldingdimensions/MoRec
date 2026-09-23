import {
	captionWordsToText,
	normalizeCaptionWordSpacing,
	normalizeCaptionWords,
} from "../captionEditing";
import { createCaptionCueId, deleteCue, splitCue } from "../captionOps";
import type { CaptionCue, CaptionCueWord, ClipRegion } from "../types";
import {
	type ClipSegment,
	planSilenceTrimApplication,
	type SuggestedSpan,
} from "./silenceSuggestions";

/**
 * Transcript word cutting (P1 Feature 3): selected caption words become source
 * time cut spans through the same pipeline the silence-removal feature uses —
 * merge, pad, reserve against zoom/speed regions, ratio-cap, then split the
 * clip model around the cuts. Cue side effects are derived here too, so no
 * caption text plays over removed footage.
 */

export interface TranscriptCutWordSpan {
	startMs: number;
	endMs: number;
}

export const TRANSCRIPT_CUT_MERGE_GAP_MS = 150;
export const TRANSCRIPT_CUT_PAD_MS = 40;
export const TRANSCRIPT_CUT_MIN_SELECTION_MS = 200;
export const TRANSCRIPT_CUT_MAX_REMOVAL_RATIO = 0.4;

export type TranscriptCutStatus =
	| "ok"
	| "no-selection"
	| "selection-too-short"
	| "overlaps-edits"
	| "too-much-selection";

export interface TranscriptCutPlan {
	status: TranscriptCutStatus;
	/** Source-time spans to cut. Empty unless the status is "ok". */
	cutSpans: SuggestedSpan[];
	/** Kept clip pieces after the cut (ids are assigned by the caller). */
	clipSegments: ClipSegment[];
	/** The parts of the cut spans that actually remove kept clip content. */
	removedSpans: SuggestedSpan[];
	/**
	 * Cue list after cues inside cut spans are deleted and straddling cues are
	 * split at the boundaries. Empty unless the status is "ok".
	 */
	cues: CaptionCue[];
	/** Words from the original cues that fall inside the final cut spans. */
	removedWordCount: number;
}

function emptyPlan(status: TranscriptCutStatus): TranscriptCutPlan {
	return {
		status,
		cutSpans: [],
		clipSegments: [],
		removedSpans: [],
		cues: [],
		removedWordCount: 0,
	};
}

/** Clamp, round, sort, and union raw word spans into a clean span list. */
function normalizeWordSpans(words: TranscriptCutWordSpan[], totalMs: number): SuggestedSpan[] {
	const bounded = words
		.filter(
			(span) =>
				Number.isFinite(span.startMs) &&
				Number.isFinite(span.endMs) &&
				span.endMs > span.startMs,
		)
		.map((span) => ({
			startMs: Math.max(0, Math.round(span.startMs)),
			endMs: Math.min(totalMs, Math.round(span.endMs)),
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
 * Grow each span by `padMs` so cuts don't clip a leading or trailing
 * consonant, then re-union anything the padding pushed together.
 */
function padSpans(spans: SuggestedSpan[], padMs: number, totalMs: number): SuggestedSpan[] {
	const padded = spans
		.map((span) => ({
			startMs: Math.max(0, span.startMs - padMs),
			endMs: Math.min(totalMs, span.endMs + padMs),
		}))
		.filter((span) => span.endMs > span.startMs);

	const merged: SuggestedSpan[] = [];
	for (const span of padded) {
		const previous = merged[merged.length - 1];
		if (previous && span.startMs <= previous.endMs) {
			previous.endMs = Math.max(previous.endMs, span.endMs);
			continue;
		}
		merged.push(span);
	}
	return merged;
}

function spansOverlap(left: SuggestedSpan, right: SuggestedSpan): boolean {
	return left.startMs < right.endMs && left.endMs > right.startMs;
}

/** Drop cut spans that touch a reserved span, expanded by `padMs` on both sides. */
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

	return spans.filter((span) => !paddedReserved.some((reserved) => spansOverlap(span, reserved)));
}

function wordLiesInsideAnyCut(
	word: Pick<CaptionCueWord, "startMs" | "endMs">,
	cuts: SuggestedSpan[],
): boolean {
	return cuts.some((cut) => word.startMs >= cut.startMs && word.endMs <= cut.endMs);
}

/**
 * Trim a word's head/tail out of any cut it touches. The ±40 ms cut padding
 * can eat a few milliseconds of a neighbouring unselected word — clip those
 * edges instead of dropping the word. Returns null when nothing audible
 * survives (fully inside a cut, or a cut runs through its middle).
 */
function clipWordAgainstCuts(
	word: CaptionCueWord,
	cuts: SuggestedSpan[],
): { startMs: number; endMs: number } | null {
	let { startMs, endMs } = word;
	for (const cut of cuts) {
		if (startMs >= cut.startMs && startMs < cut.endMs) {
			startMs = cut.endMs;
		}
		if (endMs > cut.startMs && endMs <= cut.endMs) {
			endMs = cut.startMs;
		}
	}
	if (endMs <= startMs) {
		return null;
	}
	if (cuts.some((cut) => startMs < cut.endMs && endMs > cut.startMs)) {
		return null;
	}
	return { startMs, endMs };
}

/**
 * Rebuild a cue that still overlaps a cut after splitting: `splitCue` snaps to
 * word-gap midpoints (which can land inside a padded cut) and cannot split
 * single-word cues, so fall back to word-level surgery. Surviving words are
 * edge-clipped against the cuts and regrouped into runs; a run break is forced
 * wherever a cut occupies the gap between consecutive words, so no rebuilt cue
 * ever touches a cut span.
 */
function rebuildCueAroundCuts(cue: CaptionCue, cuts: SuggestedSpan[]): CaptionCue[] {
	const clipped = normalizeCaptionWords(cue)
		.map((word) => ({ word, span: clipWordAgainstCuts(word, cuts) }))
		.filter((entry): entry is { word: CaptionCueWord; span: SuggestedSpan } =>
			Boolean(entry.span),
		);
	if (clipped.length === 0) {
		return [];
	}

	const runs: Array<Array<{ word: CaptionCueWord; span: SuggestedSpan }>> = [[clipped[0]]];
	for (let index = 1; index < clipped.length; index += 1) {
		const previous = clipped[index - 1];
		const entry = clipped[index];
		const gapTouchesCut = cuts.some(
			(cut) => cut.startMs < entry.span.startMs && cut.endMs > previous.span.endMs,
		);
		if (gapTouchesCut) {
			runs.push([]);
		}
		runs[runs.length - 1].push(entry);
	}

	return runs.map((run, runIndex) => {
		const words = normalizeCaptionWordSpacing(
			run.map((entry) => ({
				...entry.word,
				startMs: entry.span.startMs,
				endMs: entry.span.endMs,
			})),
		);
		return {
			id: runIndex === 0 ? cue.id : createCaptionCueId(),
			startMs: words[0].startMs,
			endMs: words[words.length - 1].endMs,
			text: captionWordsToText(words),
			words,
		};
	});
}

export interface TranscriptCueDerivation {
	cues: CaptionCue[];
	/** Words from the input cues that fall inside the cut spans. */
	removedWordCount: number;
}

/**
 * Derive the cue list after cutting `cutSpans` (source time): cues inside a
 * cut are deleted, cues straddling a boundary are split at it, and any
 * straggler still overlapping a cut is rebuilt from its surviving words. Every
 * returned cue lies fully outside every cut span.
 */
export function deriveCuesAfterTranscriptCut(
	cues: CaptionCue[],
	cutSpans: SuggestedSpan[],
): TranscriptCueDerivation {
	const cuts = [...cutSpans]
		.filter((span) => Number.isFinite(span.startMs) && span.endMs > span.startMs)
		.sort((left, right) => left.startMs - right.startMs || left.endMs - right.endMs);
	if (cuts.length === 0) {
		return { cues, removedWordCount: 0 };
	}

	let removedWordCount = 0;
	for (const cue of cues) {
		removedWordCount += normalizeCaptionWords(cue).filter((word) =>
			wordLiesInsideAnyCut(word, cuts),
		).length;
	}

	// Split every cue straddling a cut boundary. splitCue snaps to the nearest
	// word boundary, so pieces may still overlap the padded cut edge — the
	// rebuild pass below repairs those.
	let working = cues;
	for (const cut of cuts) {
		for (const boundaryMs of [cut.startMs, cut.endMs]) {
			for (const cue of [...working]) {
				if (cue.startMs < boundaryMs && boundaryMs < cue.endMs) {
					working = splitCue(working, cue.id, boundaryMs);
				}
			}
		}
	}

	// Delete pieces fully inside a cut span.
	for (const cue of [...working]) {
		if (cuts.some((cut) => cue.startMs >= cut.startMs && cue.endMs <= cut.endMs)) {
			working = deleteCue(working, cue.id);
		}
	}

	const repaired: CaptionCue[] = [];
	for (const cue of working) {
		const overlapsCut = cuts.some((cut) => spansOverlap(cue, cut));
		repaired.push(...(overlapsCut ? rebuildCueAroundCuts(cue, cuts) : [cue]));
	}

	return { cues: repaired, removedWordCount };
}

/**
 * Turn selected transcript word spans into the full cut plan: guards and
 * normalizes the spans, splits the clip model around them, and derives the
 * caption side effects. All spans are source-time milliseconds.
 */
export function planTranscriptCut(params: {
	/** Selected word spans (source time). */
	words: TranscriptCutWordSpan[];
	cues: CaptionCue[];
	clips: ClipRegion[];
	/** Total source duration in milliseconds. */
	totalMs: number;
	/** Existing zoom/speed regions (source time) the cuts must not touch. */
	reservedSpans?: SuggestedSpan[];
}): TranscriptCutPlan {
	const { words, cues, clips, totalMs, reservedSpans = [] } = params;

	if (!Number.isFinite(totalMs) || totalMs <= 0) {
		return emptyPlan("no-selection");
	}

	const normalized = normalizeWordSpans(words, totalMs);
	if (normalized.length === 0) {
		return emptyPlan("no-selection");
	}

	const selectedMs = normalized.reduce((sum, span) => sum + (span.endMs - span.startMs), 0);
	if (selectedMs < TRANSCRIPT_CUT_MIN_SELECTION_MS) {
		return emptyPlan("selection-too-short");
	}

	const merged = mergeSpansByGap(normalized, TRANSCRIPT_CUT_MERGE_GAP_MS);
	const padded = padSpans(merged, TRANSCRIPT_CUT_PAD_MS, totalMs);
	const cutSpans = excludeReserved(padded, reservedSpans, TRANSCRIPT_CUT_PAD_MS);
	if (cutSpans.length === 0) {
		// The selection existed but every span came near a zoom/speed region.
		return emptyPlan("overlaps-edits");
	}

	const totalCutMs = cutSpans.reduce((sum, span) => sum + (span.endMs - span.startMs), 0);
	if (totalCutMs > totalMs * TRANSCRIPT_CUT_MAX_REMOVAL_RATIO) {
		return emptyPlan("too-much-selection");
	}

	const { clipSegments, removedSpans } = planSilenceTrimApplication(clips, cutSpans);
	const { cues: nextCues, removedWordCount } = deriveCuesAfterTranscriptCut(cues, cutSpans);

	return {
		status: "ok",
		cutSpans,
		clipSegments,
		removedSpans,
		cues: nextCues,
		removedWordCount,
	};
}
