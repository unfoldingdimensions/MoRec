import { describe, expect, it } from "vitest";

import { ATEMPO_FILTER_EPSILON, buildAtempoFilters } from "./filters";

describe("buildAtempoFilters", () => {
	it("returns no filters for unit tempo", () => {
		expect(buildAtempoFilters(1)).toEqual([]);
		expect(buildAtempoFilters(1 + ATEMPO_FILTER_EPSILON / 2)).toEqual([]);
	});

	it("returns no filters for invalid tempo values", () => {
		expect(buildAtempoFilters(Number.NaN)).toEqual([]);
		expect(buildAtempoFilters(0)).toEqual([]);
		expect(buildAtempoFilters(-1.5)).toEqual([]);
	});

	it("emits a single atempo for ratios inside the 0.5-2.0 native range", () => {
		expect(buildAtempoFilters(0.75)).toEqual(["atempo=0.750000"]);
		expect(buildAtempoFilters(1.5)).toEqual(["atempo=1.500000"]);
		expect(buildAtempoFilters(2)).toEqual(["atempo=2.000000"]);
	});

	it("chains atempo steps for ratios below 0.5", () => {
		expect(buildAtempoFilters(0.25)).toEqual(["atempo=0.5", "atempo=0.500000"]);
		expect(buildAtempoFilters(0.125)).toEqual([
			"atempo=0.5",
			"atempo=0.5",
			"atempo=0.500000",
		]);
	});

	it("chains atempo steps for ratios above 2", () => {
		expect(buildAtempoFilters(4)).toEqual(["atempo=2.0", "atempo=2.000000"]);
		expect(buildAtempoFilters(3)).toEqual(["atempo=2.0", "atempo=1.500000"]);
	});

	it("lands exactly on the native lower bound without an extra halving step", () => {
		expect(buildAtempoFilters(0.5)).toEqual(["atempo=0.500000"]);
	});
});
