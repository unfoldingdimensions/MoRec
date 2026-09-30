import { normalizeCaptionWords } from "../captionEditing";
import type { CaptionCue, ClipRegion } from "../types";
import type { SuggestedSpan } from "./silenceSuggestions";
import {
	planTranscriptCut,
	TRANSCRIPT_CUT_MERGE_GAP_MS,
	TRANSCRIPT_CUT_PAD_MS,
	type TranscriptCutPlan,
} from "./transcriptCutting";

/**
 * Filler-word removal: caption words like "um" and "uh" become source-time cut
 * spans through the transcript-cutting pipeline — the same guards, clip
 * splitting, and caption side-effects as manual word cutting, so the two
 * features behave identically and undo works through the shared history.
 *
 * Detection is deliberately per-word and conservative: a token matches only in
 * full, so "umbrella" can never match "um", and the default lexicon holds
 * pure interjections. Ambivalent words ("like", "well", "so", "right") are
 * usually meaningful and stay — over-cutting real words is the failure mode
 * this module must not introduce.
 */

/**
 * The default filler lexicon (named, exported): lowercase interjection bases.
 * Tokens are normalized before lookup (case, surrounding punctuation, and
 * repeated-letter runs collapse — "Umm…" and "uhhh" both match), so this list
 * needs no spelling variants. Extend it for more fillers; keep it to words
 * that are virtually always disfluencies.
 */
export const DEFAULT_FILLER_LEXICON: readonly string[] = [
	"um",
	"uh",
	"erm",
	"er",
	"ah",
	"oh",
	"eh",
	"hmm",
	"hm",
	"huh",
	"mhm",
];

/**
 * Fillers this close together (ms) merge into one cut, so an "um, uh" pair is
 * a single snip instead of two. Same value and mechanism as transcript
 * cutting — aliased here to name the window for this feature.
 */
export const FILLER_CUT_MERGE_GAP_MS = TRANSCRIPT_CUT_MERGE_GAP_MS;

/**
 * Breathing room (ms) added around each filler cut so the snip doesn't clip a
 * leading or trailing consonant. Same value as transcript cutting's pad.
 */
export const FILLER_CUT_PAD_MS = TRANSCRIPT_CUT_PAD_MS;

export interface FillerWordMatch {
	text: string;
	startMs: number;
	endMs: number;
}

/** Lowercase, reduce every non-letter run to a separator, drop empties. */
function splitIntoLetterParts(text: string): string[] {
	return text
		.toLowerCase()
		.replace(/[^a-z]+/g, " ")
		.trim()
		.split(/\s+/)
		.filter(Boolean);
}

/** Collapse runs of the same letter: "uhhh" → "uh", "hmmmm" → "hm". */
function collapseLetterRuns(part: string): string {
	return part.replace(/(.)\1+/g, "$1");
}

function isFillerToken(text: string, fillerTokens: ReadonlySet<string>): boolean {
	const parts = splitIntoLetterParts(text);
	if (parts.length === 0) {
		return false;
	}
	// Every hyphen/apostrophe-separated part must be a filler, so "uh-huh"
	// matches while no compound containing a real word can.
	return parts.every((part) => fillerTokens.has(collapseLetterRuns(part)));
}

/**
 * Finds filler words in the transcript. Word timings are source-time
 * milliseconds, matching the cut pipeline's units. Cues without real word
 * timing are handled the same way transcript cutting handles them (placeholder
 * timings derived from the text).
 */
export function detectFillerWords(
	cues: CaptionCue[],
	lexicon: readonly string[] = DEFAULT_FILLER_LEXICON,
): FillerWordMatch[] {
	// Lexicon entries normalize through the same splitter as transcript tokens,
	// so multi-part entries like "uh-huh" contribute their parts.
	const fillerTokens = new Set(
		lexicon.flatMap((entry) => splitIntoLetterParts(entry).map(collapseLetterRuns)),
	);

	const matches: FillerWordMatch[] = [];
	for (const cue of cues) {
		for (const word of normalizeCaptionWords(cue)) {
			if (isFillerToken(word.text, fillerTokens)) {
				matches.push({ text: word.text, startMs: word.startMs, endMs: word.endMs });
			}
		}
	}

	return matches.sort((left, right) => left.startMs - right.startMs || left.endMs - right.endMs);
}

export type FillerSuggestionStatus =
	| "ok"
	| "no-fillers"
	| "too-short"
	| "overlaps-edits"
	| "too-much";

export interface FillerCutSuggestion {
	status: FillerSuggestionStatus;
	/** The detected filler words, before guards. Empty when nothing matched. */
	fillers: FillerWordMatch[];
	/**
	 * The full transcript-cut plan (merged + padded cut spans, kept clip
	 * pieces, captions with side-effects applied, removedWordCount). Null
	 * unless the status is "ok".
	 */
	plan: TranscriptCutPlan | null;
}

/**
 * Turns filler matches into a guarded cut plan. The guards are
 * `planTranscriptCut`'s — reserved-span rejection against zoom/speed regions,
 * the minimum-selection floor, and the total-removal ratio cap — mapped onto
 * filler-domain statuses so callers get one honest verdict per click:
 *
 * - `no-fillers`: nothing in the lexicon appears in the transcript
 * - `too-short`: fillers exist but total less than the minimum cut floor
 * - `overlaps-edits`: every filler sits in or next to a zoom/speed region
 * - `too-much`: the cuts would remove more than the removal-ratio cap
 */
export function buildFillerCutSuggestions(params: {
	cues: CaptionCue[];
	clips: ClipRegion[];
	/** Total source duration in milliseconds. */
	totalMs: number;
	/** Existing zoom/speed regions (source time) the cuts must not touch. */
	reservedSpans?: SuggestedSpan[];
	lexicon?: readonly string[];
}): FillerCutSuggestion {
	const { cues, clips, totalMs, reservedSpans = [], lexicon = DEFAULT_FILLER_LEXICON } = params;

	const fillers = detectFillerWords(cues, lexicon);
	if (fillers.length === 0) {
		return { status: "no-fillers", fillers, plan: null };
	}

	const plan = planTranscriptCut({
		words: fillers.map(({ startMs, endMs }) => ({ startMs, endMs })),
		cues,
		clips,
		totalMs,
		reservedSpans,
	});

	switch (plan.status) {
		case "ok":
			return { status: "ok", fillers, plan };
		case "no-selection":
			return { status: "no-fillers", fillers, plan: null };
		case "selection-too-short":
			return { status: "too-short", fillers, plan: null };
		case "overlaps-edits":
			return { status: "overlaps-edits", fillers, plan: null };
		case "too-much-selection":
			return { status: "too-much", fillers, plan: null };
	}
}
