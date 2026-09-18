import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { ClipRegion } from "../types";
import {
	DEFAULT_DEAD_AIR_MIN_SILENCE_MS,
	DEFAULT_TRIM_MAX_REMOVAL_RATIO,
	buildDeadAirSpeedSuggestions,
	buildSilenceTrimSuggestions,
	planSilenceTrimApplication,
	type SilenceSpanInput,
	type SuggestedSpan,
} from "./silenceSuggestions";

function span(startMs: number, endMs: number): SuggestedSpan {
	return { startMs, endMs };
}

function clipsFromRanges(ranges: Array<[number, number]>): ClipRegion[] {
	return ranges.map(([startMs, endMs], index) => ({
		id: `clip-${index + 1}`,
		startMs,
		endMs,
		speed: 1,
	}));
}

describe("buildSilenceTrimSuggestions", () => {
	it("returns no-silence when no interval clears the minimum duration", () => {
		const result = buildSilenceTrimSuggestions({
			intervals: [span(0, 500), span(2000, 2699)],
			totalMs: 10_000,
		});
		expect(result).toEqual({ status: "no-silence", suggestions: [] });
	});

	it("keeps padding of quiet room around each cut", () => {
		// One 1000ms silence starting at 1000: cut [1120, 1880] with default pad 120.
		const result = buildSilenceTrimSuggestions({
			intervals: [span(1000, 2000)],
			totalMs: 10_000,
		});
		expect(result.status).toBe("ok");
		expect(result.suggestions).toEqual([span(1120, 1880)]);
	});

	it("merges silences separated by less than the merge gap", () => {
		const result = buildSilenceTrimSuggestions({
			intervals: [span(1000, 1600), span(1800, 3000)],
			totalMs: 20_000,
			minSilenceMs: 500,
		});
		expect(result.status).toBe("ok");
		// 600 + 1200 merged across the 200ms gap -> one 1400ms span, padded.
		expect(result.suggestions).toEqual([span(1120, 2880)]);
	});

	it("skips candidates that come near a reserved zoom/speed span", () => {
		const result = buildSilenceTrimSuggestions({
			intervals: [span(1000, 3000), span(5000, 7000)],
			totalMs: 20_000,
			reservedSpans: [span(2900, 4200)],
		});
		expect(result.status).toBe("ok");
		// First silence ends 100ms from the reserved span (pad 120) — dropped.
		expect(result.suggestions).toEqual([span(5120, 6880)]);
	});

	it("returns too-much-silence and nothing else when the cut exceeds the ratio cap", () => {
		const result = buildSilenceTrimSuggestions({
			intervals: [span(0, 4000), span(5000, 8000)],
			totalMs: 10_000,
			minSilenceMs: 1000,
		});
		expect(result).toEqual({ status: "too-much-silence", suggestions: [] });
		expect(DEFAULT_TRIM_MAX_REMOVAL_RATIO).toBe(0.45);
	});

	it("clamps intervals to the recording bounds and drops invalid ones", () => {
		const messy: SilenceSpanInput[] = [
			{ startMs: -500, endMs: 900 },
			{ startMs: 400, endMs: 400 },
			{ startMs: Number.NaN, endMs: 5000 },
			{ startMs: 9000, endMs: 99_000 },
		];
		const result = buildSilenceTrimSuggestions({
			intervals: messy,
			totalMs: 10_000,
			minSilenceMs: 500,
		});
		expect(result.status).toBe("ok");
		// Leading interval clamps to [0, 900], the trailing one to [9000, 10_000].
		expect(result.suggestions).toEqual([span(120, 780), span(9120, 9880)]);
	});
});

describe("buildDeadAirSpeedSuggestions", () => {
	it("only considers silences at or above the dead-air threshold", () => {
		const result = buildDeadAirSpeedSuggestions({
			intervals: [span(1000, 1900), span(4000, 6000)],
			totalMs: 20_000,
		});
		expect(result.status).toBe("ok");
		expect(result.suggestions).toEqual([span(4000, 6000)]);
		expect(DEFAULT_DEAD_AIR_MIN_SILENCE_MS).toBe(1200);
	});

	it("gives trims precedence: only the untrimmed remainder is sped up", () => {
		const result = buildDeadAirSpeedSuggestions({
			intervals: [span(1000, 5000)],
			totalMs: 20_000,
			trimmedSpans: [span(1000, 3000)],
		});
		expect(result.status).toBe("ok");
		expect(result.suggestions).toEqual([span(3000, 5000)]);
	});

	it("returns no-silence when trims already removed every long silence", () => {
		const result = buildDeadAirSpeedSuggestions({
			intervals: [span(1000, 5000)],
			totalMs: 20_000,
			trimmedSpans: [span(0, 20_000)],
		});
		expect(result).toEqual({ status: "no-silence", suggestions: [] });
	});

	it("reserves existing zoom/speed regions", () => {
		const result = buildDeadAirSpeedSuggestions({
			intervals: [span(1000, 5000), span(8000, 12_000)],
			totalMs: 30_000,
			reservedSpans: [span(9000, 10_000)],
		});
		expect(result.status).toBe("ok");
		expect(result.suggestions).toEqual([span(1000, 5000)]);
	});
});

describe("planSilenceTrimApplication", () => {
	it("splits clips around each suggestion and reports the real removals", () => {
		const clips = clipsFromRanges([
			[0, 10_000],
			[12_000, 20_000],
		]);
		const plan = planSilenceTrimApplication(clips, [span(4000, 5000), span(15_000, 16_000)]);

		expect(plan.clipSegments).toEqual([
			{ startMs: 0, endMs: 4000, speed: 1 },
			{ startMs: 5000, endMs: 10_000, speed: 1 },
			{ startMs: 12_000, endMs: 15_000, speed: 1 },
			{ startMs: 16_000, endMs: 20_000, speed: 1 },
		]);
		expect(plan.removedSpans).toEqual([span(4000, 5000), span(15_000, 16_000)]);
	});

	it("ignores suggestions over already-trimmed ranges and keeps clip extras", () => {
		const clips: ClipRegion[] = [
			{ id: "clip-1", startMs: 2000, endMs: 8000, speed: 1, muted: true },
		];
		const plan = planSilenceTrimApplication(clips, [span(0, 1000), span(4000, 5000)]);

		// The [0, 1000) cut hits no kept content; the clip keeps its muted flag.
		expect(plan.removedSpans).toEqual([span(4000, 5000)]);
		expect(plan.clipSegments).toEqual([
			{ startMs: 2000, endMs: 4000, speed: 1, muted: true },
			{ startMs: 5000, endMs: 8000, speed: 1, muted: true },
		]);
	});
});

describe("suggestion span invariants (fast-check)", () => {
	const intervalArb = fc
		.integer({ min: 0, max: 40 })
		.chain((startTick) =>
			fc
				.integer({ min: 1, max: 30 })
				.map((widthTicks) => ({
					startMs: startTick * 500,
					endMs: (startTick + widthTicks) * 500,
				})),
		);
	const intervalsArb = fc.array(intervalArb, { maxLength: 12 });

	function expectWellFormed(
		suggestions: SuggestedSpan[],
		totalMs: number,
		minSpanMs: number,
		reserved: SuggestedSpan[],
		padMs: number,
	) {
		for (let index = 0; index < suggestions.length; index += 1) {
			const current = suggestions[index];
			expect(current.endMs).toBeGreaterThan(current.startMs);
			expect(current.startMs).toBeGreaterThanOrEqual(0);
			expect(current.endMs).toBeLessThanOrEqual(totalMs);
			expect(current.endMs - current.startMs).toBeGreaterThanOrEqual(minSpanMs);
			if (index > 0) {
				expect(current.startMs).toBeGreaterThanOrEqual(suggestions[index - 1].endMs);
			}
			for (const reservedSpan of reserved) {
				const padded = {
					startMs: reservedSpan.startMs - padMs,
					endMs: reservedSpan.endMs + padMs,
				};
				const overlaps =
					current.startMs < padded.endMs && current.endMs > padded.startMs;
				expect(overlaps).toBe(false);
			}
		}
	}

	it("trim suggestions are sorted, disjoint, bounded, and ratio-capped", () => {
		const totalMs = 20_000;
		fc.assert(
			fc.property(intervalsArb, (intervals) => {
				const result = buildSilenceTrimSuggestions({
					intervals,
					totalMs,
					minSilenceMs: 700,
				});
				expectWellFormed(result.suggestions, totalMs, 1, [], 0);
				const removedMs = result.suggestions.reduce(
					(sum, suggestion) => sum + (suggestion.endMs - suggestion.startMs),
					0,
				);
				expect(removedMs).toBeLessThanOrEqual(totalMs * DEFAULT_TRIM_MAX_REMOVAL_RATIO + 1);
			}),
		);
	});

	it("dead-air suggestions never touch reserved or trimmed spans", () => {
		const totalMs = 30_000;
		const reservedArb = fc.array(
			fc
				.integer({ min: 0, max: 55 })
				.chain((startTick) =>
					fc.integer({ min: 1, max: 5 }).map((w) => span(startTick * 500, (startTick + w) * 500)),
				),
			{ maxLength: 4 },
		);
		fc.assert(
			fc.property(intervalsArb, reservedArb, reservedArb, (intervals, zooms, trims) => {
				const result = buildDeadAirSpeedSuggestions({
					intervals,
					totalMs,
					minSilenceMs: 1200,
					reservedSpans: zooms,
					trimmedSpans: trims,
				});
				expectWellFormed(result.suggestions, totalMs, DEFAULT_DEAD_AIR_MIN_SILENCE_MS, zooms, 0);
				for (const suggestion of result.suggestions) {
					for (const trim of trims) {
						const inside =
							suggestion.startMs >= trim.startMs && suggestion.endMs <= trim.endMs;
						expect(inside).toBe(false);
					}
				}
			}),
		);
	});
});
