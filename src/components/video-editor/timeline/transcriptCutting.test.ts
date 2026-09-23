import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type ClipRegion, clipsToTrims, trimsToClips } from "../types";
import type { SuggestedSpan } from "./silenceSuggestions";
import {
	deriveCuesAfterTranscriptCut,
	planTranscriptCut,
	TRANSCRIPT_CUT_MAX_REMOVAL_RATIO,
	TRANSCRIPT_CUT_MIN_SELECTION_MS,
	TRANSCRIPT_CUT_PAD_MS,
	type TranscriptCutWordSpan,
} from "./transcriptCutting";

function word(startMs: number, endMs: number): TranscriptCutWordSpan {
	return { startMs, endMs };
}

function span(startMs: number, endMs: number): SuggestedSpan {
	return { startMs, endMs };
}

function fullTrackClip(totalMs: number): ClipRegion[] {
	return [{ id: "clip-1", startMs: 0, endMs: totalMs, speed: 1 }];
}

describe("planTranscriptCut guards and spans", () => {
	it("returns no-selection for an empty or invalid selection", () => {
		for (const words of [[], [word(Number.NaN, 500)], [word(500, 400)]]) {
			expect(
				planTranscriptCut({
					words,
					cues: [],
					clips: fullTrackClip(10_000),
					totalMs: 10_000,
				}).status,
			).toBe("no-selection");
		}
	});

	it("rejects selections shorter than the 200ms minimum", () => {
		const result = planTranscriptCut({
			words: [word(1000, 1150)],
			cues: [],
			clips: fullTrackClip(10_000),
			totalMs: 10_000,
		});
		expect(result.status).toBe("selection-too-short");
		expect(TRANSCRIPT_CUT_MIN_SELECTION_MS).toBe(200);
	});

	it("accepts a selection that exactly meets the minimum", () => {
		const result = planTranscriptCut({
			words: [word(1000, 1100), word(2000, 2100)],
			cues: [],
			clips: fullTrackClip(10_000),
			totalMs: 10_000,
		});
		expect(result.status).toBe("ok");
	});

	it("merges word spans separated by at most the 150ms gap", () => {
		const merged = planTranscriptCut({
			words: [word(1000, 1200), word(1350, 1500)],
			cues: [],
			clips: fullTrackClip(10_000),
			totalMs: 10_000,
		});
		expect(merged.status).toBe("ok");
		expect(merged.cutSpans).toEqual([span(960, 1540)]);

		const separate = planTranscriptCut({
			words: [word(1000, 1200), word(1360, 1500)],
			cues: [],
			clips: fullTrackClip(10_000),
			totalMs: 10_000,
		});
		expect(separate.status).toBe("ok");
		expect(separate.cutSpans).toEqual([span(960, 1240), span(1320, 1540)]);
	});

	it("pads each cut by 40ms and clamps to the recording bounds", () => {
		const result = planTranscriptCut({
			words: [word(20, 300), word(9700, 9990)],
			cues: [],
			clips: fullTrackClip(10_000),
			totalMs: 10_000,
		});
		expect(result.status).toBe("ok");
		expect(result.cutSpans).toEqual([span(0, 340), span(9660, 10_000)]);
		expect(TRANSCRIPT_CUT_PAD_MS).toBe(40);
	});

	it("drops cut spans near reserved regions and reports when nothing remains", () => {
		const partial = planTranscriptCut({
			words: [word(1000, 2000), word(5000, 6000)],
			cues: [],
			clips: fullTrackClip(10_000),
			totalMs: 10_000,
			reservedSpans: [span(2000, 3000)],
		});
		expect(partial.status).toBe("ok");
		expect(partial.cutSpans).toEqual([span(4960, 6040)]);

		const blocked = planTranscriptCut({
			words: [word(1000, 2000), word(5000, 6000)],
			cues: [],
			clips: fullTrackClip(10_000),
			totalMs: 10_000,
			reservedSpans: [span(1500, 2500), span(5200, 5800)],
		});
		expect(blocked.status).toBe("overlaps-edits");
		expect(blocked.cutSpans).toEqual([]);
	});

	it("caps the total cut at 40% of the source", () => {
		const words = [0, 1, 2, 3, 4].map((index) => word(200 + index * 1800, 1100 + index * 1800));
		const result = planTranscriptCut({
			words,
			cues: [],
			clips: fullTrackClip(10_000),
			totalMs: 10_000,
		});
		// 5x900ms words, padded to 980ms each = 4900ms > 4000ms.
		expect(result.status).toBe("too-much-selection");
		expect(result.cutSpans).toEqual([]);
		expect(TRANSCRIPT_CUT_MAX_REMOVAL_RATIO).toBe(0.4);
	});

	it("splits the clip model around the cut and reports real removals", () => {
		const result = planTranscriptCut({
			words: [word(1000, 1500)],
			cues: [],
			clips: fullTrackClip(10_000),
			totalMs: 10_000,
		});
		expect(result.status).toBe("ok");
		expect(result.clipSegments).toEqual([
			{ startMs: 0, endMs: 960, speed: 1 },
			{ startMs: 1540, endMs: 10_000, speed: 1 },
		]);
		expect(result.removedSpans).toEqual([span(960, 1540)]);
	});

	it("keeps clip speed flags on the surviving segments", () => {
		const result = planTranscriptCut({
			words: [word(1000, 1500)],
			cues: [],
			clips: [{ id: "clip-1", startMs: 0, endMs: 10_000, speed: 2, muted: true }],
			totalMs: 10_000,
		});
		expect(result.clipSegments).toEqual([
			{ startMs: 0, endMs: 960, speed: 2, muted: true },
			{ startMs: 1540, endMs: 10_000, speed: 2, muted: true },
		]);
	});

	it("reports no removal for cuts that only hit already-trimmed footage", () => {
		const clips = trimsToClips([span(4000, 6000)], 10_000);
		const result = planTranscriptCut({
			words: [word(4300, 4900)],
			cues: [],
			clips,
			totalMs: 10_000,
		});
		expect(result.status).toBe("ok");
		expect(result.cutSpans).toEqual([span(4260, 4940)]);
		expect(result.removedSpans).toEqual([]);
	});
});

describe("deriveCuesAfterTranscriptCut", () => {
	it("deletes cues that lie fully inside a cut span", () => {
		const cues = [
			{
				id: "cue-1",
				startMs: 1000,
				endMs: 2000,
				text: "umm well",
				words: [
					{ text: "umm", startMs: 1000, endMs: 1500 },
					{ text: "well", startMs: 1500, endMs: 2000, leadingSpace: true },
				],
			},
		];
		const result = deriveCuesAfterTranscriptCut(cues, [span(960, 2040)]);
		expect(result.cues).toEqual([]);
		expect(result.removedWordCount).toBe(2);
	});

	it("splits a straddling cue at the cut boundaries", () => {
		const cues = [
			{
				id: "cue-1",
				startMs: 0,
				endMs: 3000,
				text: "Hello um world",
				words: [
					{ text: "Hello", startMs: 0, endMs: 500 },
					{ text: "um", startMs: 1000, endMs: 1200, leadingSpace: true },
					{ text: "world", startMs: 2000, endMs: 2500, leadingSpace: true },
				],
			},
		];
		const result = deriveCuesAfterTranscriptCut(cues, [span(960, 1240)]);
		expect(result.cues.map((cue) => cue.text)).toEqual(["Hello", "world"]);
		// The trailing piece keeps the original cue end (splitCue semantics).
		expect(result.cues.map((cue) => [cue.startMs, cue.endMs])).toEqual([
			[0, 500],
			[2000, 3000],
		]);
		// The leading piece keeps the original cue id so the editor selection survives.
		expect(result.cues[0].id).toBe("cue-1");
		expect(result.cues[1].id).not.toBe("cue-1");
		expect(result.removedWordCount).toBe(1);
	});

	it("clips a neighbouring word instead of dropping it when padding bites its edge", () => {
		const cues = [
			{
				id: "cue-1",
				startMs: 0,
				endMs: 2000,
				text: "keep um this",
				words: [
					{ text: "keep", startMs: 0, endMs: 490 },
					{ text: "um", startMs: 500, endMs: 700, leadingSpace: true },
					{ text: "this", startMs: 800, endMs: 1200, leadingSpace: true },
				],
			},
		];
		// Padded cut around "um": [460, 740] — eats 30ms of "keep"'s tail.
		const result = deriveCuesAfterTranscriptCut(cues, [span(460, 740)]);
		expect(result.cues.map((cue) => cue.text)).toEqual(["keep", "this"]);
		expect(result.cues[0]).toMatchObject({ startMs: 0, endMs: 460 });
		// "this" comes from splitCue's trailing piece, which keeps the cue end.
		expect(result.cues[1]).toMatchObject({ startMs: 800, endMs: 2000 });
		expect(result.removedWordCount).toBe(1);
	});

	it("clips the head of a single-word cue that cannot be split", () => {
		const cues = [
			{
				id: "cue-1",
				startMs: 980,
				endMs: 1500,
				text: "speech",
				words: [{ text: "speech", startMs: 980, endMs: 1500 }],
			},
		];
		const result = deriveCuesAfterTranscriptCut(cues, [span(960, 1000)]);
		expect(result.cues).toHaveLength(1);
		expect(result.cues[0]).toMatchObject({
			id: "cue-1",
			startMs: 1000,
			endMs: 1500,
			text: "speech",
		});
	});

	it("derives words for text-only cues from the text", () => {
		const cues = [{ id: "cue-1", startMs: 1000, endMs: 2200, text: "so um here" }];
		// Even word distribution: so [1000,1400), um [1400,1800), here [1800,2200].
		const result = deriveCuesAfterTranscriptCut(cues, [span(1360, 1840)]);
		expect(result.cues.map((cue) => cue.text)).toEqual(["so", "here"]);
		expect(result.removedWordCount).toBe(1);
	});

	it("returns the cues unchanged when there are no cuts", () => {
		const cues = [{ id: "cue-1", startMs: 1000, endMs: 2000, text: "keep" }];
		expect(deriveCuesAfterTranscriptCut(cues, [])).toEqual({
			cues,
			removedWordCount: 0,
		});
	});
});

describe("transcript cut invariants (fast-check)", () => {
	const TOTAL_MS = 20_000;

	const wordSpanArb = fc.integer({ min: 0, max: 37 }).chain((startTick) =>
		fc.integer({ min: 1, max: 4 }).map((widthTicks) => ({
			startMs: startTick * 500,
			endMs: (startTick + widthTicks) * 500,
		})),
	);
	const wordsArb = fc.array(wordSpanArb, { maxLength: 10 });

	const reservedSpanArb = fc.integer({ min: 0, max: 34 }).chain((startTick) =>
		fc.integer({ min: 1, max: 5 }).map((widthTicks) => ({
			startMs: startTick * 500,
			endMs: (startTick + widthTicks) * 500,
		})),
	);
	const reservedArb = fc.array(reservedSpanArb, { maxLength: 4 });

	// Existing trims live in two disjoint bands so trimsToClips gets sorted,
	// disjoint input clips.
	const existingTrimsArb = fc
		.tuple(
			fc.integer({ min: 0, max: 8 }),
			fc.integer({ min: 1, max: 4 }),
			fc.integer({ min: 20, max: 32 }),
			fc.integer({ min: 1, max: 4 }),
		)
		.map(([a, b, c, d]) => [span(a * 500, (a + b) * 500), span(c * 500, (c + d) * 500)]);

	// Cues sit on a 4000ms lattice with 2-5 sequential words each, word gaps
	// small enough that padding regularly bites neighbouring words.
	const cuesArb = fc.array(fc.integer({ min: 2, max: 5 }), { maxLength: 4 }).map((counts) => {
		let id = 0;
		return counts.map((wordCount, cueIndex) => {
			const cueStartMs = cueIndex * 4000;
			const words = Array.from({ length: wordCount }, (_, wordIndex) => {
				const startMs = cueStartMs + wordIndex * 350;
				const endMs = startMs + 250 + ((wordIndex * 37) % 80);
				return {
					text: `w${wordIndex}`,
					startMs,
					endMs,
					...(wordIndex > 0 ? { leadingSpace: true } : {}),
				};
			});
			return {
				id: `cue-${++id}`,
				startMs: cueStartMs,
				endMs: words[words.length - 1].endMs + ((cueIndex * 53) % 150),
				text: words.map((w) => w.text).join(" "),
				words,
			};
		});
	});

	function expectSpansWellFormed(spans: SuggestedSpan[], totalMs: number, label: string) {
		for (let index = 0; index < spans.length; index += 1) {
			const current = spans[index];
			expect(Number.isFinite(current.startMs), `${label} start finite`).toBe(true);
			expect(Number.isFinite(current.endMs), `${label} end finite`).toBe(true);
			expect(current.startMs, `${label} within bounds`).toBeGreaterThanOrEqual(0);
			expect(current.endMs, `${label} within bounds`).toBeLessThanOrEqual(totalMs);
			expect(current.endMs, `${label} positive span`).toBeGreaterThan(current.startMs);
			if (index > 0) {
				expect(current.startMs, `${label} monotonic + disjoint`).toBeGreaterThanOrEqual(
					spans[index - 1].endMs,
				);
			}
		}
	}

	function spansOverlap(left: SuggestedSpan, right: SuggestedSpan) {
		return left.startMs < right.endMs && left.endMs > right.startMs;
	}

	it("cut plans are monotonic, disjoint, bounded, ratio-capped, and cue-clean", () => {
		fc.assert(
			fc.property(
				wordsArb,
				reservedArb,
				existingTrimsArb,
				cuesArb,
				(words, reserved, existingTrims, cues) => {
					const clips = trimsToClips(existingTrims, TOTAL_MS).map((clip, index) => ({
						...clip,
						id: `clip-${index + 1}`,
					}));
					const plan = planTranscriptCut({
						words,
						cues,
						clips,
						totalMs: TOTAL_MS,
						reservedSpans: reserved,
					});

					if (plan.status !== "ok") {
						expect(plan.cutSpans).toEqual([]);
						expect(plan.cues).toEqual([]);
						return;
					}

					expectSpansWellFormed(plan.cutSpans, TOTAL_MS, "cut span");

					for (const cut of plan.cutSpans) {
						for (const reservedSpan of reserved) {
							const padded = {
								startMs: reservedSpan.startMs - TRANSCRIPT_CUT_PAD_MS,
								endMs: reservedSpan.endMs + TRANSCRIPT_CUT_PAD_MS,
							};
							expect(spansOverlap(cut, padded), "cut avoids reserved spans").toBe(
								false,
							);
						}
					}

					const totalCutMs = plan.cutSpans.reduce(
						(sum, span) => sum + (span.endMs - span.startMs),
						0,
					);
					expect(totalCutMs).toBeLessThanOrEqual(
						TOTAL_MS * TRANSCRIPT_CUT_MAX_REMOVAL_RATIO,
					);

					// The trims the editor derives from the surviving clips stay
					// monotonic, disjoint, and inside the recording, and they cover
					// every span the plan says was removed.
					const nextClips = plan.clipSegments.map((segment, index) => ({
						...segment,
						id: `clip-${index + 1}`,
					}));
					const trims = clipsToTrims(nextClips, TOTAL_MS);
					expectSpansWellFormed(trims, TOTAL_MS, "trim span");
					for (const removed of plan.removedSpans) {
						const covered = trims.some(
							(trim) =>
								removed.startMs >= trim.startMs && removed.endMs <= trim.endMs,
						);
						expect(covered, "removed span lands in a derived trim").toBe(true);
					}

					for (const cue of plan.cues) {
						expect(cue.endMs).toBeGreaterThan(cue.startMs);
						expect(cue.text.length).toBeGreaterThan(0);
						for (const cut of plan.cutSpans) {
							expect(spansOverlap(cue, cut), "remaining cue avoids cut spans").toBe(
								false,
							);
						}
					}
				},
			),
		);
	});

	it("cue derivation keeps every cue outside arbitrary cut spans", () => {
		fc.assert(
			fc.property(cuesArb, reservedArb, (cues, cuts) => {
				const derivation = deriveCuesAfterTranscriptCut(cues, cuts);
				for (const cue of derivation.cues) {
					expect(cue.endMs).toBeGreaterThan(cue.startMs);
					expect(cue.startMs).toBeGreaterThanOrEqual(0);
					expect(cue.text.length).toBeGreaterThan(0);
					for (const cut of cuts) {
						expect(spansOverlap(cue, cut), "derived cue avoids cut spans").toBe(false);
					}
					if (Array.isArray(cue.words) && cue.words.length > 0) {
						for (const w of cue.words) {
							expect(w.endMs).toBeGreaterThan(w.startMs);
						}
					}
				}
			}),
		);
	});
});
