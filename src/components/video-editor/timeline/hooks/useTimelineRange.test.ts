import { describe, expect, it } from "vitest";

import { resolveTimelineWheelPanDeltaPx, resolveTimelineWheelZoomRange } from "./useTimelineRange";

describe("resolveTimelineWheelPanDeltaPx", () => {
	it("uses trackpad horizontal wheel movement for timeline panning", () => {
		expect(
			resolveTimelineWheelPanDeltaPx({
				deltaX: 24,
				deltaY: 0,
				deltaMode: 0,
			}),
		).toBe(24);
	});

	it("uses shifted vertical wheel movement for timeline panning", () => {
		expect(
			resolveTimelineWheelPanDeltaPx({
				deltaX: 0,
				deltaY: 3,
				deltaMode: 1,
				shiftKey: true,
			}),
		).toBe(48);
	});

	it("keeps ctrl wheel available for timeline zoom unless shift is also held", () => {
		expect(
			resolveTimelineWheelPanDeltaPx({
				deltaX: 0,
				deltaY: 3,
				deltaMode: 1,
				ctrlKey: true,
			}),
		).toBe(0);
		expect(
			resolveTimelineWheelPanDeltaPx({
				deltaX: 0,
				deltaY: 3,
				deltaMode: 1,
				ctrlKey: true,
				shiftKey: true,
			}),
		).toBe(48);
	});

	it("uses regular wheel movement when the timeline has no vertical overflow", () => {
		expect(
			resolveTimelineWheelPanDeltaPx({
				deltaX: 0,
				deltaY: 20,
				deltaMode: 0,
				canScrollVertically: false,
			}),
		).toBe(20);
	});
});

describe("resolveTimelineWheelZoomRange", () => {
	it("zooms in around the cursor so the pivot time stays put", () => {
		const next = resolveTimelineWheelZoomRange({
			previous: { start: 0, end: 10_000 },
			deltaPx: -100,
			pivotRatio: 0.25,
			totalMs: 60_000,
			minVisibleRangeMs: 1_000,
		});

		expect(next).not.toBeNull();
		const span = next!.end - next!.start;
		expect(span).toBeLessThan(10_000);
		const pivotBefore = 0 + 0.25 * 10_000;
		const pivotAfter = next!.start + 0.25 * span;
		expect(Math.abs(pivotAfter - pivotBefore)).toBeLessThanOrEqual(1);
	});

	it("zooms out and clamps the span to the full timeline", () => {
		const next = resolveTimelineWheelZoomRange({
			previous: { start: 0, end: 1_000 },
			deltaPx: 100_000,
			pivotRatio: 0.5,
			totalMs: 2_000,
			minVisibleRangeMs: 1_000,
		});

		expect(next).toEqual({ start: 0, end: 2_000 });
	});

	it("never zooms in past the minimum visible range", () => {
		const next = resolveTimelineWheelZoomRange({
			previous: { start: 5_000, end: 15_000 },
			deltaPx: -100_000,
			pivotRatio: 0.5,
			totalMs: 60_000,
			minVisibleRangeMs: 4_000,
		});

		expect(next!.end - next!.start).toBe(4_000);
	});

	it("keeps the zoomed range inside the timeline bounds", () => {
		const next = resolveTimelineWheelZoomRange({
			previous: { start: 50_000, end: 60_000 },
			deltaPx: -100,
			pivotRatio: 0,
			totalMs: 60_000,
			minVisibleRangeMs: 1_000,
		});

		expect(next!.start).toBeGreaterThanOrEqual(0);
		expect(next!.end).toBeLessThanOrEqual(60_000);
	});

	it("returns null for zero delta or an empty timeline", () => {
		expect(
			resolveTimelineWheelZoomRange({
				previous: { start: 0, end: 10_000 },
				deltaPx: 0,
				pivotRatio: 0.5,
				totalMs: 60_000,
				minVisibleRangeMs: 1_000,
			}),
		).toBeNull();
		expect(
			resolveTimelineWheelZoomRange({
				previous: { start: 0, end: 10_000 },
				deltaPx: -100,
				pivotRatio: 0.5,
				totalMs: 0,
				minVisibleRangeMs: 1_000,
			}),
		).toBeNull();
	});
});
