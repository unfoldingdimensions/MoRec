import { describe, expect, it } from "vitest";
import type { CursorTelemetryPoint } from "../types";
import {
	MAX_TYPING_SPEEDUP_RATIO,
	TYPING_PAD_MS,
	buildTypingSpeedSuggestions,
	detectTypingBurstsMs,
	extractKeyEventTimesMs,
} from "./typingSuggestions";

function keySample(timeMs: number): CursorTelemetryPoint {
	return { timeMs, cx: 0.5, cy: 0.5, interactionType: "key" };
}

function moveSample(timeMs: number): CursorTelemetryPoint {
	return { timeMs, cx: 0.5, cy: 0.5, interactionType: "move" };
}

describe("extractKeyEventTimesMs", () => {
	it("collects only key events, sorted, ignoring non-finite times", () => {
		expect(
			extractKeyEventTimesMs([
				keySample(3000),
				moveSample(3100),
				keySample(1000),
				{ timeMs: Number.NaN, cx: 0.1, cy: 0.1, interactionType: "key" },
			]),
		).toEqual([1000, 3000]);
	});
});

describe("detectTypingBurstsMs", () => {
	it("groups keys within the rolling window and requires the minimum count", () => {
		// 4 keys, 300ms apart -> one burst.
		expect(detectTypingBurstsMs([0, 300, 600, 900])).toEqual([{ startMs: 0, endMs: 900 }]);
		// 2 keys only -> no burst.
		expect(detectTypingBurstsMs([0, 300])).toEqual([]);
	});

	it("splits bursts when a gap exceeds the window and drops short runs", () => {
		const times = [0, 200, 400, 2401, 5000, 5200, 5400];
		expect(detectTypingBurstsMs(times)).toEqual([
			{ startMs: 0, endMs: 400 },
			{ startMs: 5000, endMs: 5400 },
		]);
	});
});

describe("buildTypingSpeedSuggestions", () => {
	it("reports no-keys without key telemetry", () => {
		expect(
			buildTypingSpeedSuggestions({ cursorTelemetry: [moveSample(0), moveSample(100)], totalMs: 5000 }),
		).toEqual({ status: "no-keys", suggestions: [] });
	});

	it("pads bursts and keeps only sustained typing", () => {
		// 3 keys 400ms apart: burst 0..800 (800ms < 1500ms alone), padded
		// +/-250 -> 0..1050, still under the sustained threshold -> dropped.
		const tooShort = buildTypingSpeedSuggestions({
			cursorTelemetry: [keySample(0), keySample(400), keySample(800)],
			totalMs: 10_000,
		});
		expect(tooShort.status).toBe("no-bursts");

		// 5 keys over 1.6s: padded burst 0..2100 is kept.
		const sustained = buildTypingSpeedSuggestions({
			cursorTelemetry: [
				keySample(0),
				keySample(400),
				keySample(800),
				keySample(1200),
				keySample(1600),
			],
			totalMs: 10_000,
		});
		expect(sustained.status).toBe("ok");
		expect(sustained.suggestions).toEqual([{ startMs: 0, endMs: 1850 }]);
		expect(TYPING_PAD_MS).toBe(250);
	});

	it("skips bursts that overlap reserved zoom/speed regions", () => {
		const result = buildTypingSpeedSuggestions({
			cursorTelemetry: [
				keySample(0),
				keySample(400),
				keySample(800),
				keySample(1200),
				keySample(1600),
			],
			totalMs: 10_000,
			reservedSpans: [{ startMs: 0, endMs: 3000 }],
		});
		expect(result).toEqual({ status: "no-bursts", suggestions: [] });
	});

	it("caps the accelerated total at 40% of the recording, longest bursts first", () => {
		// 6 keys 300ms apart: raw span 1500ms, padded 2000ms — sustained.
		const burstAt = (startMs: number) =>
			[0, 1, 2, 3, 4, 5].map((offset) => keySample(startMs + offset * 300));
		const cursorTelemetry = [
			...burstAt(0), // padded -250..1750 clamped to 0..1750
			...burstAt(2000), // padded 1750..3750; merges with the first (gap 0)
			...burstAt(6000), // padded 5750..7750
			...burstAt(14_000), // keys past totalMs are ignored
		];
		const totalMs = 10_000; // cap 4000ms of acceleration
		const result = buildTypingSpeedSuggestions({ cursorTelemetry, totalMs });

		// Available: 0..3750 (3750ms) and 5750..7750 (2000ms). Longest-first
		// greedy keeps 3750ms; adding 2000ms would exceed the 4000ms cap.
		expect(result.status).toBe("ok");
		expect(result.suggestions).toEqual([{ startMs: 0, endMs: 3750 }]);
		const acceleratedMs = result.suggestions.reduce(
			(sum, span) => sum + (span.endMs - span.startMs),
			0,
		);
		expect(acceleratedMs).toBeLessThanOrEqual(totalMs * MAX_TYPING_SPEEDUP_RATIO);
		for (const span of result.suggestions) {
			expect(span.endMs).toBeLessThanOrEqual(totalMs);
			expect(span.startMs).toBeGreaterThanOrEqual(0);
		}
	});
});
