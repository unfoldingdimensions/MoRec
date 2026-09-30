import { describe, expect, it } from "vitest";
import fc from "fast-check";

import type { CaptionCue, ClipRegion } from "../types";
import {
	buildFillerCutSuggestions,
	detectFillerWords,
	FILLER_CUT_MERGE_GAP_MS,
	FILLER_CUT_PAD_MS,
} from "./fillerSuggestions";

const TOTAL_MS = 60_000;

function fullTrackClips(totalMs = TOTAL_MS): ClipRegion[] {
	return [{ id: "clip-1", startMs: 0, endMs: totalMs, speed: 1 }];
}

function cue(
	id: string,
	words: Array<[text: string, startMs: number, endMs: number]>,
): CaptionCue {
	return {
		id,
		startMs: words[0][1],
		endMs: words[words.length - 1][2],
		text: words.map(([text]) => text).join(" "),
		words: words.map(([text, startMs, endMs], index) => ({
			text,
			startMs,
			endMs,
			...(index > 0 ? { leadingSpace: true } : {}),
		})),
	};
}

function suggestion(
	cues: CaptionCue[],
	overrides: Partial<Parameters<typeof buildFillerCutSuggestions>[0]> = {},
) {
	return buildFillerCutSuggestions({
		cues,
		clips: fullTrackClips(),
		totalMs: TOTAL_MS,
		...overrides,
	});
}

describe("detectFillerWords", () => {
	it("finds um/uh mid-cue with word timings", () => {
		const cues = [
			cue("c1", [
				["So", 0, 300],
				["um", 300, 520],
				["hello", 520, 900],
				["world", 900, 1_300],
			]),
		];

		expect(detectFillerWords(cues)).toEqual([{ text: "um", startMs: 300, endMs: 520 }]);
	});

	it("matches punctuation, casing, and repeated-letter variants", () => {
		const cues = [
			cue("c1", [
				["Um,", 0, 200],
				["the", 200, 400],
				["UHH", 400, 600],
				["hmmmm", 600, 900],
				["end", 900, 1_100],
			]),
		];

		expect(detectFillerWords(cues).map((match) => match.text)).toEqual([
			"Um,",
			"UHH",
			"hmmmm",
		]);
	});

	it("never matches a filler inside a real word", () => {
		const realWords = [
			"umbrella",
			"under",
			"her",
			"amber",
			"hamburger",
			"arm",
			"earn",
			"irregular",
			"ohio",
			"mother",
			"another",
			"ether",
		];
		const cues = [
			cue(
				"c1",
				realWords.map((word, index) => [word, index * 400, index * 400 + 300]),
			),
		];

		expect(detectFillerWords(cues)).toEqual([]);
	});

	it("matches hyphenated filler tokens part-by-part", () => {
		const cues = [
			cue("c1", [
				["uh-huh", 0, 300],
				["words", 300, 700],
			]),
		];

		expect(detectFillerWords(cues)).toHaveLength(1);
	});
});

describe("buildFillerCutSuggestions — detection and spans", () => {
	it("cuts a filler in the middle of a fluent phrase, per word", () => {
		const cues = [
			cue("c1", [
				["The", 0, 300],
				["umbrella", 300, 800],
				["is", 800, 950],
				["um", 950, 1_200],
				["right", 1_200, 1_500],
				["there", 1_500, 1_900],
			]),
		];

		const outcome = suggestion(cues);
		expect(outcome.status).toBe("ok");
		expect(outcome.plan!.cutSpans).toHaveLength(1);
		// Only the "um" span, padded — nothing else in the phrase is touched.
		expect(outcome.plan!.cutSpans[0]).toEqual({
			startMs: 950 - FILLER_CUT_PAD_MS,
			endMs: 1_200 + FILLER_CUT_PAD_MS,
		});
		expect(outcome.plan!.removedWordCount).toBe(1);
	});

	it("merges adjacent fillers within the merge window into one cut", () => {
		const cues = [
			cue("c1", [
				["um", 1_000, 1_200],
				["uh", 1_300, 1_500],
				["speech", 1_500, 2_000],
			]),
		];

		const outcome = suggestion(cues);
		expect(outcome.status).toBe("ok");
		expect(outcome.plan!.cutSpans).toEqual([
			{
				startMs: 1_000 - FILLER_CUT_PAD_MS,
				endMs: 1_500 + FILLER_CUT_PAD_MS,
			},
		]);
		expect(FILLER_CUT_MERGE_GAP_MS).toBeGreaterThan(0);
	});

	it("keeps distant fillers as separate cuts", () => {
		const cues = [
			cue("c1", [
				["um", 1_000, 1_300],
				["speech", 1_300, 8_000],
				["uh", 8_000, 8_300],
				["more", 8_300, 9_000],
			]),
		];

		const outcome = suggestion(cues);
		expect(outcome.status).toBe("ok");
		expect(outcome.plan!.cutSpans).toHaveLength(2);
	});

	it("pads cut spans by the named pad constant without leaving the recording", () => {
		const cues = [cue("c1", [["um", 0, 200]])];

		const outcome = suggestion(cues);
		expect(outcome.plan!.cutSpans[0].startMs).toBe(0);
		expect(outcome.plan!.cutSpans[0].endMs).toBe(200 + FILLER_CUT_PAD_MS);
	});
});

describe("buildFillerCutSuggestions — guard statuses", () => {
	it("reports no-fillers for a clean transcript", () => {
		const cues = [
			cue("c1", [
				["Hello", 0, 400],
				["everyone", 400, 900],
			]),
		];

		const outcome = suggestion(cues);
		expect(outcome.status).toBe("no-fillers");
		expect(outcome.plan).toBeNull();
		expect(outcome.fillers).toEqual([]);
	});

	it("reports too-short when the fillers total below the cut floor", () => {
		const cues = [cue("c1", [["um", 1_000, 1_060]])];

		const outcome = suggestion(cues);
		expect(outcome.status).toBe("too-short");
		expect(outcome.plan).toBeNull();
	});

	it("reports overlaps-edits when a zoom region reserves the filler", () => {
		const cues = [
			cue("c1", [
				["um", 5_000, 5_400],
				["words", 5_400, 6_200],
			]),
		];

		const outcome = suggestion(cues, {
			reservedSpans: [{ startMs: 4_800, endMs: 5_600 }],
		});
		expect(outcome.status).toBe("overlaps-edits");
		expect(outcome.plan).toBeNull();
	});

	it("reports too-much when the cuts exceed the removal ratio", () => {
		const words: Array<[string, number, number]> = [];
		let cursorMs = 0;
		for (let index = 0; index < 20; index += 1) {
			const isFiller = index % 2 === 0;
			words.push([isFiller ? "um" : "word", cursorMs, cursorMs + 900]);
			cursorMs += 1_000;
		}
		const cues = [cue("c1", words)];
		// The recording is exactly the transcript's span: half of it is fillers.
		const recordingMs = cursorMs;

		const outcome = suggestion(cues, {
			totalMs: recordingMs,
			clips: fullTrackClips(recordingMs),
		});
		expect(outcome.status).toBe("too-much");
		expect(outcome.plan).toBeNull();
	});
});

describe("buildFillerCutSuggestions — caption side-effects", () => {
	it("leaves no cue overlapping any cut span", () => {
		const cues = [
			cue("c1", [
				["So", 0, 300],
				["um", 300, 520],
				["hello", 520, 900],
				["everyone", 900, 1_400],
			]),
			// Fully inside a cut: the whole cue must be deleted.
			cue("c2", [
				["uh", 3_000, 3_300],
				["um", 3_300, 3_600],
			]),
			cue("c3", [
				["Final", 5_000, 5_400],
				["words", 5_400, 5_900],
			]),
		];

		const outcome = suggestion(cues);
		expect(outcome.status).toBe("ok");
		const plan = outcome.plan!;

		for (const cut of plan.cutSpans) {
			for (const cueValue of plan.cues) {
				expect(cueValue.endMs <= cut.startMs || cueValue.startMs >= cut.endMs).toBe(true);
			}
		}
		// The mid-cue filler was removed from the text, and the all-filler cue
		// is gone entirely.
		expect(plan.cues.map((cueValue) => cueValue.text).join(" ")).not.toMatch(/\b(uh|um)\b/i);
		expect(plan.cues.some((cueValue) => cueValue.id === "c2")).toBe(false);
		// Untouched cues keep their identity.
		expect(plan.cues.some((cueValue) => cueValue.id === "c3")).toBe(true);
	});
});

describe("buildFillerCutSuggestions — fast-check invariants", () => {
	it("produces monotonic, non-overlapping, in-bounds cut spans", () => {
		fc.assert(
			fc.property(
				fc.integer({ min: 8, max: 40 }),
				fc.integer({ min: 0, max: 0x7fffffff }),
				(wordCount, seed) => {
					// Tiny deterministic LCG so failures reproduce for the shrunk seed.
					let state = seed || 1;
					const nextInt = () => {
						state = (state * 1_664_525 + 1_013_904_223) % 0x1_0000_0000;
						return state;
					};
					const words: Array<{ text: string; startMs: number; endMs: number }> = [];
					let cursorMs = 500;
					for (let index = 0; index < wordCount; index += 1) {
						const durationMs = 120 + (nextInt() % 230);
						const filler = index % 4 === 0 && nextInt() % 2 === 0;
						words.push({
							text: filler ? "um" : "measurement",
							startMs: cursorMs,
							endMs: cursorMs + durationMs,
						});
						cursorMs += durationMs + 40 + (nextInt() % 160);
					}
					const totalMs = cursorMs + 500;

					const outcome = buildFillerCutSuggestions({
						cues: [cue("c1", words.map((word) => [word.text, word.startMs, word.endMs]))],
						clips: fullTrackClips(totalMs),
						totalMs,
					});

					expect(["ok", "no-fillers", "too-short"]).toContain(outcome.status);
					if (outcome.status !== "ok") {
						return;
					}

					const spans = outcome.plan!.cutSpans;
					expect(spans.length).toBeGreaterThan(0);
					for (const span of spans) {
						expect(span.startMs).toBeGreaterThanOrEqual(0);
						expect(span.endMs).toBeLessThanOrEqual(totalMs);
						expect(span.endMs).toBeGreaterThan(span.startMs);
					}
					for (let index = 1; index < spans.length; index += 1) {
						expect(spans[index].startMs).toBeGreaterThanOrEqual(spans[index - 1].endMs);
					}
					for (const cut of spans) {
						for (const cueValue of outcome.plan!.cues) {
							expect(cueValue.endMs <= cut.startMs || cueValue.startMs >= cut.endMs).toBe(
								true,
							);
						}
					}
				},
			),
			{ numRuns: 60 },
		);
	});
});
