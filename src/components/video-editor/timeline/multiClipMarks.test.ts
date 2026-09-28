import { describe, expect, it } from "vitest";
import {
	deriveMultiClipRanges,
	normalizeMarkList,
} from "./multiClipMarks";

describe("normalizeMarkList", () => {
	it("drops 0:00 marks, non-finite entries, and double-taps", () => {
		expect(normalizeMarkList([0, 100, 5000, 5200, 5500, "x", null, 9000.4])).toEqual([
			5000,
			5500,
			9000,
		]);
	});

	it("clamps marks beyond the duration", () => {
		expect(normalizeMarkList([1000, 5000, 9000], 6000)).toEqual([1000, 5000]);
	});
});

describe("deriveMultiClipRanges", () => {
	it("splits the recording at marks with discard-defaulted takes before each mark", () => {
		const ranges = deriveMultiClipRanges([10_000, 20_000], 30_000);
		expect(ranges).toEqual([
			{ startMs: 0, endMs: 10_000, discard: true },
			{ startMs: 10_000, endMs: 20_000, discard: true },
			{ startMs: 20_000, endMs: 30_000, discard: false },
		]);
	});

	it("ignores a mark at 0:00", () => {
		// 0:00 is dropped by normalization, so only one usable mark remains.
		const ranges = deriveMultiClipRanges([0], 30_000);
		expect(ranges).toEqual([]);
	});

	it("returns [] with no marks or an unknown duration", () => {
		expect(deriveMultiClipRanges([], 30_000)).toEqual([]);
		expect(deriveMultiClipRanges([10_000], 0)).toEqual([]);
		expect(deriveMultiClipRanges([10_000], Number.NaN)).toEqual([]);
	});

	it("drops takes shorter than 250 ms at the boundaries", () => {
		const ranges = deriveMultiClipRanges([200, 30_000], 60_000);
		expect(ranges).toEqual([
			{ startMs: 0, endMs: 30_000, discard: true },
			{ startMs: 30_000, endMs: 60_000, discard: false },
		]);
	});

	it("survives marks at the very end of the recording", () => {
		const ranges = deriveMultiClipRanges([59_000], 60_000);
		expect(ranges).toEqual([
			{ startMs: 0, endMs: 59_000, discard: true },
			{ startMs: 59_000, endMs: 60_000, discard: false },
		]);
		expect(deriveMultiClipRanges([60_000], 60_000)).toEqual([]);
	});
});
