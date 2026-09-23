/**
 * Heuristic summary engine — always available, no API key required.
 *
 * Derives a video title, a short summary, and YouTube-style chapters purely
 * from caption text and editing structure:
 * - title: the first fluent caption sentence, capped at 80 characters
 * - summary: the first two caption sentences
 * - chapters: boundaries at the largest zoom regions, or (when no zooms
 *   exist) at silences of >= 45 s; minimum chapter length 30 s, max 12
 *   chapters, each titled from the caption text inside its span.
 *
 * Pure module: silence intervals are precomputed by the caller (ffmpeg
 * silencedetect via analyze-companion-audio-silence) and passed in.
 */

export interface HeuristicCue {
	startMs: number;
	endMs: number;
	text: string;
}

export interface HeuristicZoomRegion {
	startMs: number;
	endMs: number;
	depth?: number;
}

export interface HeuristicSilenceInterval {
	startMs: number;
	endMs: number;
}

export interface HeuristicChapter {
	startMs: number;
	title: string;
}

export interface HeuristicSummary {
	title: string;
	summary: string;
	chapters: HeuristicChapter[];
}

const TITLE_MAX_CHARS = 80;
const MIN_FLUENT_WORDS = 4;
const MIN_CHAPTER_MS = 30_000;
const MAX_CHAPTERS = 12;
const SILENCE_BOUNDARY_MS = 45_000;

/** Split transcript text into sentences, keeping only substantial ones. */
export function splitSentences(text: string): string[] {
	const normalized = text.replace(/\s+/g, " ").trim();
	if (!normalized) {
		return [];
	}

	// Cue text is often unpunctuated; a boundary is sentence punctuation
	// followed by whitespace, otherwise each cue is treated as one sentence.
	const parts = normalized
		.split(/(?<=[.!?…])\s+/)
		.map((part) => part.trim())
		.filter(Boolean);
	return parts.length > 0 ? parts : [normalized];
}

function sentenceFluencyOk(sentence: string): boolean {
	const words = sentence.match(/\S+/g);
	return words !== null && words.length >= MIN_FLUENT_WORDS;
}

/** First fluent sentence capped at 80 characters on a word boundary. */
function deriveTitle(sentences: string[], fallbackTitle: string): string {
	const fluent = sentences.find(sentenceFluencyOk);
	const chosen = fluent ?? sentences[0];
	if (!chosen) {
		return fallbackTitle;
	}
	if (chosen.length <= TITLE_MAX_CHARS) {
		return chosen;
	}
	const clipped = chosen.slice(0, TITLE_MAX_CHARS);
	const lastSpace = clipped.lastIndexOf(" ");
	return (lastSpace > 0 ? clipped.slice(0, lastSpace) : clipped).trim();
}

/**
 * Sentence stream with cue timestamps so chapters can be titled from the
 * caption text spoken inside their span.
 */
interface TimedSentence {
	startMs: number;
	text: string;
}

export function buildTimedSentences(cues: HeuristicCue[]): TimedSentence[] {
	const sentences: TimedSentence[] = [];
	for (const cue of cues) {
		const text = cue.text.replace(/\s+/g, " ").trim();
		if (!text) {
			continue;
		}
		const parts = splitSentences(text);
		for (const part of parts) {
			sentences.push({ startMs: cue.startMs, text: part });
		}
	}
	return sentences;
}

function zoomWeight(region: HeuristicZoomRegion): number {
	const durationMs = Math.max(0, region.endMs - region.startMs);
	return durationMs * Math.max(1, region.depth ?? 1);
}

function chapterTitleForSpan(
	startMs: number,
	endMs: number,
	sentences: TimedSentence[],
): string {
	const spoken = sentences.find(
		(sentence) => sentence.startMs >= startMs && sentence.startMs < endMs,
	);
	const text = spoken?.text.trim() ?? "";
	if (!text) {
		return "";
	}
	return text.length <= TITLE_MAX_CHARS ? text : `${text.slice(0, TITLE_MAX_CHARS - 1).trim()}…`;
}

function chaptersFromBoundaries(
	candidates: Array<{ boundaryMs: number; weight: number }>,
	durationMs: number,
	sentences: TimedSentence[],
): HeuristicChapter[] {
	const totalMs = durationMs > 0 ? durationMs : Number.POSITIVE_INFINITY;
	// "Largest zooms first": walk candidates in weight order, keeping a
	// boundary only if it respects the minimum chapter length against every
	// already-kept boundary, until the 0:00 chapter plus MAX_CHAPTERS-1 more.
	const kept: number[] = [0];
	for (const { boundaryMs } of [...candidates].sort(
		(left, right) => right.weight - left.weight,
	)) {
		if (kept.length >= MAX_CHAPTERS) {
			break;
		}
		if (boundaryMs <= 0 || boundaryMs >= totalMs) {
			continue;
		}
		if (kept.some((existing) => Math.abs(existing - boundaryMs) < MIN_CHAPTER_MS)) {
			continue;
		}
		kept.push(boundaryMs);
	}
	// A lone 0:00 entry is not a chapter list.
	if (kept.length < 2) {
		return [];
	}
	kept.sort((left, right) => left - right);

	return kept.map((startMs, index) => {
		const endMs = index + 1 < kept.length ? kept[index + 1] : totalMs;
		return {
			startMs,
			title: chapterTitleForSpan(startMs, endMs, sentences),
		};
	});
}

export function deriveHeuristicSummary(options: {
	cues: HeuristicCue[];
	zoomRegions: HeuristicZoomRegion[];
	durationMs: number;
	silenceIntervals?: HeuristicSilenceInterval[];
	fallbackTitle?: string;
}): HeuristicSummary {
	const { cues, zoomRegions, durationMs } = options;
	const sentences = buildTimedSentences(cues);
	const fallbackTitle = options.fallbackTitle?.trim() || "Recording";

	const title = deriveTitle(
		sentences.map((sentence) => sentence.text),
		fallbackTitle,
	);
	// Summary starts at the first fluent sentence — a filler opener ("um, so…")
	// is a real caption sentence but a bad summary lead.
	const fluentSentences = sentences.filter((sentence) =>
		sentenceFluencyOk(sentence.text),
	);
	const summarySource =
		fluentSentences.length >= 2 ? fluentSentences : sentences;
	const summary = summarySource
		.slice(0, 2)
		.map((sentence) => sentence.text)
		.join(" ")
		.trim();

	const zoomCandidates = zoomRegions.map((region) => ({
		boundaryMs: Math.round(region.startMs),
		weight: zoomWeight(region),
	}));

	let candidates = zoomCandidates;
	if (zoomCandidates.length === 0) {
		// No zoom structure: fall back to long silences as section boundaries.
		candidates = (options.silenceIntervals ?? [])
			.filter((interval) => interval.endMs - interval.startMs >= SILENCE_BOUNDARY_MS)
			.map((interval) => ({
				boundaryMs: Math.round(interval.endMs),
				weight: interval.endMs - interval.startMs,
			}));
	}

	const chapters = chaptersFromBoundaries(candidates, durationMs, sentences);
	return { title, summary, chapters };
}
