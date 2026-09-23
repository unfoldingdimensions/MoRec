import { describe, expect, it } from "vitest";
import {
	buildTimedSentences,
	deriveHeuristicSummary,
	splitSentences,
	type HeuristicCue,
} from "./heuristics";

function cue(startMs: number, text: string, durationMs = 2000): HeuristicCue {
	return { startMs, endMs: startMs + durationMs, text };
}

describe("splitSentences / buildTimedSentences", () => {
	it("splits on sentence punctuation and keeps unpunctuated text whole", () => {
		expect(splitSentences("Hello there. This is great! Really?")).toEqual([
			"Hello there.",
			"This is great!",
			"Really?",
		]);
		expect(splitSentences("no punctuation here")).toEqual(["no punctuation here"]);
		expect(splitSentences("   ")).toEqual([]);
	});

	it("maps sentences to cue timestamps", () => {
		const sentences = buildTimedSentences([
			cue(1000, "First sentence here. Second one too."),
			cue(5000, "Third sentence."),
		]);
		expect(sentences.map((s) => s.startMs)).toEqual([1000, 1000, 5000]);
		expect(sentences[2].text).toBe("Third sentence.");
	});
});

describe("deriveHeuristicSummary", () => {
	it("derives title from the first fluent sentence and summary from two sentences", () => {
		const result = deriveHeuristicSummary({
			cues: [
				cue(0, "um yeah so"),
				cue(2000, "Welcome back to the channel. Today we build a birdhouse."),
				cue(6000, "First we cut the boards."),
			],
			zoomRegions: [],
			durationMs: 10_000,
		});
		expect(result.title).toBe("Welcome back to the channel.");
		expect(result.summary).toBe(
			"Welcome back to the channel. Today we build a birdhouse.",
		);
	});

	it("caps the title at 80 characters on a word boundary", () => {
		const longSentence =
			"This is an extremely long fluent sentence that just keeps going and going well past eighty characters for sure.";
		const result = deriveHeuristicSummary({
			cues: [cue(0, longSentence)],
			zoomRegions: [],
			durationMs: 5000,
		});
		expect(result.title.length).toBeLessThanOrEqual(80);
		expect(result.title.startsWith("This is an extremely long")).toBe(true);
	});

	it("falls back to the file name when there is no caption text", () => {
		const result = deriveHeuristicSummary({
			cues: [],
			zoomRegions: [],
			durationMs: 5000,
			fallbackTitle: "my-recording",
		});
		expect(result.title).toBe("my-recording");
		expect(result.summary).toBe("");
		expect(result.chapters).toEqual([]);
	});

	it("builds chapters from zoom-region boundaries with a 30 s minimum", () => {
		const result = deriveHeuristicSummary({
			cues: [
				cue(0, "Intro of the video."),
				cue(60_000, "Deep dive section starts."),
				cue(150_000, "Wrap up everything."),
			],
			zoomRegions: [
				{ startMs: 15_000, endMs: 16_000, depth: 2 },
				{ startMs: 60_000, endMs: 66_000, depth: 3 },
				{ startMs: 80_000, endMs: 81_000, depth: 1 },
				{ startMs: 150_000, endMs: 152_000, depth: 4 },
			],
			durationMs: 200_000,
		});
		// First chapter always starts at 0:00; the 15 s boundary is within 30 s
		// of 0:00 and the 80 s boundary within 30 s of the 60 s chapter, so
		// both are dropped.
		expect(result.chapters.map((chapter) => chapter.startMs)).toEqual([
			0,
			60_000,
			150_000,
		]);
		expect(result.chapters[0].title).toBe("Intro of the video.");
		expect(result.chapters[1].title).toBe("Deep dive section starts.");
	});

	it("prefers the largest zoom when two boundaries conflict", () => {
		const result = deriveHeuristicSummary({
			cues: [cue(0, "Start talking here.")],
			zoomRegions: [
				// 70 s zoom is bigger (duration x depth) than the 60 s one; they
				// sit within the 30 s minimum, so only the larger survives.
				{ startMs: 60_000, endMs: 61_000, depth: 1 },
				{ startMs: 70_000, endMs: 80_000, depth: 6 },
				{ startMs: 120_000, endMs: 121_000, depth: 1 },
			],
			durationMs: 180_000,
		});
		expect(result.chapters.map((chapter) => chapter.startMs)).toEqual([
			0,
			70_000,
			120_000,
		]);
	});

	it("uses >=45 s silence boundaries when no zoom regions exist", () => {
		const result = deriveHeuristicSummary({
			cues: [
				cue(0, "Opening remarks."),
				cue(100_000, "Back from the break."),
			],
			zoomRegions: [],
			durationMs: 180_000,
			silenceIntervals: [
				{ startMs: 20_000, endMs: 30_000 }, // too short (<45 s)
				{ startMs: 50_000, endMs: 100_000 }, // 50 s silence -> boundary at 100 s
			],
		});
		expect(result.chapters.map((chapter) => chapter.startMs)).toEqual([0, 100_000]);
		expect(result.chapters[1].title).toBe("Back from the break.");
	});

	it("caps chapters at 12", () => {
		const zoomRegions = Array.from({ length: 30 }, (_, index) => ({
			startMs: (index + 1) * 45_000,
			endMs: (index + 1) * 45_000 + 10_000,
			depth: 3,
		}));
		const result = deriveHeuristicSummary({
			cues: [cue(0, "Talking about things.")],
			zoomRegions,
			durationMs: 30 * 60_000,
		});
		expect(result.chapters).toHaveLength(12);
	});
});
