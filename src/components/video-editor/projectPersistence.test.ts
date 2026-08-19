import { describe, expect, it } from "vitest";

import { normalizeProjectEditor, normalizeRegionTiming } from "./projectPersistence";
import { ADVANCED_VERTICAL_PADDING_MAX } from "./types";

describe("normalizeRegionTiming", () => {
	it("normalizes valid region start and end ms", () => {
		expect(normalizeRegionTiming(1000, 3000)).toEqual({ startMs: 1000, endMs: 3000 });
	});

	it("falls back to 0 start and default duration for non-finite inputs", () => {
		expect(normalizeRegionTiming(null, undefined)).toEqual({ startMs: 0, endMs: 1000 });
	});

	it("swaps and clamps when endMs is before startMs", () => {
		expect(normalizeRegionTiming(5000, 2000)).toEqual({ startMs: 2000, endMs: 2001 });
	});

	it("ensures endMs is at least startMs + 1", () => {
		expect(normalizeRegionTiming(1000, 1000)).toEqual({ startMs: 1000, endMs: 1001 });
	});
});

describe("normalizeProjectEditor", () => {
	it("preserves the extended advanced vertical padding range", () => {
		const editor = normalizeProjectEditor({
			padding: {
				top: 240,
				bottom: ADVANCED_VERTICAL_PADDING_MAX,
				left: 22,
				right: 22,
				linked: false,
			},
		});

		expect(editor.padding).toMatchObject({
			top: 240,
			bottom: ADVANCED_VERTICAL_PADDING_MAX,
			left: 22,
			right: 22,
			linked: false,
		});
	});

	it("keeps linked padding clamped to the original range", () => {
		const editor = normalizeProjectEditor({
			padding: {
				top: ADVANCED_VERTICAL_PADDING_MAX,
				bottom: ADVANCED_VERTICAL_PADDING_MAX,
				left: ADVANCED_VERTICAL_PADDING_MAX,
				right: ADVANCED_VERTICAL_PADDING_MAX,
				linked: true,
			},
		});

		expect(editor.padding).toMatchObject({
			top: 100,
			bottom: 100,
			left: 100,
			right: 100,
			linked: true,
		});
	});

	it("preserves custom autoCaptionSettings fontFamily", () => {
		const editor = normalizeProjectEditor({
			autoCaptionSettings: {
				fontFamily: '"Geist", sans-serif',
				fontSize: 32,
			},
		});

		expect(editor.autoCaptionSettings).toMatchObject({
			fontFamily: '"Geist", sans-serif',
			fontSize: 32,
		});
	});

	it("falls back to default caption fontFamily when autoCaptionSettings fontFamily is empty or omitted", () => {
		const editor = normalizeProjectEditor({
			autoCaptionSettings: {
				fontFamily: "   ",
			},
		});

		expect(editor.autoCaptionSettings.fontFamily).toBe(
			'"SF Pro Text", "SF Pro Display", Helvetica, sans-serif',
		);
	});

	it("validates and clamps shadowIntensity properly", () => {
		expect(normalizeProjectEditor({ shadowIntensity: 0.45 }).shadowIntensity).toBe(0.45);
		expect(normalizeProjectEditor({ shadowIntensity: -2 }).shadowIntensity).toBe(0);
		expect(normalizeProjectEditor({ shadowIntensity: 10 }).shadowIntensity).toBe(1);
		expect(normalizeProjectEditor({ shadowIntensity: Number.NaN }).shadowIntensity).toBe(0.67);
		expect(normalizeProjectEditor({ shadowIntensity: Number.POSITIVE_INFINITY }).shadowIntensity).toBe(0.67);
		expect(normalizeProjectEditor({ shadowIntensity: undefined }).shadowIntensity).toBe(0.67);
	});

	it("validates and clamps borderRadius properly", () => {
		expect(normalizeProjectEditor({ borderRadius: 25 }).borderRadius).toBe(25);
		expect(normalizeProjectEditor({ borderRadius: -10 }).borderRadius).toBe(0);
		expect(normalizeProjectEditor({ borderRadius: 500 }).borderRadius).toBe(200);
		expect(normalizeProjectEditor({ borderRadius: Number.NaN }).borderRadius).toBe(12.5);
		expect(normalizeProjectEditor({ borderRadius: Number.NEGATIVE_INFINITY }).borderRadius).toBe(12.5);
		expect(normalizeProjectEditor({ borderRadius: undefined }).borderRadius).toBe(12.5);
	});
});
