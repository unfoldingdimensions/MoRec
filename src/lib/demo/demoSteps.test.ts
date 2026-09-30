import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { mapCursorToCanvasNormalized } from "@/lib/extensions/cursorCoordinates";
import type { CursorTelemetryPoint } from "@/components/video-editor/types";
import {
	DEFAULT_DEMO_STEP_CAP,
	DEMO_STEP_MERGE_GAP_MS,
	deriveDemoStepGraph,
} from "./demoSteps";

const TOTAL_MS = 60_000;

function click(
	timeMs: number,
	cx: number,
	cy: number,
	interactionType: CursorTelemetryPoint["interactionType"] = "click",
): CursorTelemetryPoint {
	return { timeMs, cx, cy, interactionType };
}

function move(timeMs: number, cx: number, cy: number): CursorTelemetryPoint {
	return { timeMs, cx, cy };
}

describe("deriveDemoStepGraph — detection", () => {
	it("turns explicit clicks into ordered steps with mapped advance hotspots", () => {
		const graph = deriveDemoStepGraph({
			cursorTelemetry: [
				move(0, 0.1, 0.1),
				click(1_000, 0.2, 0.4),
				move(1_500, 0.25, 0.45),
				click(4_000, 0.6, 0.7),
				move(5_000, 0.65, 0.75),
			],
			totalMs: TOTAL_MS,
		});

		expect(graph.status).toBe("ok");
		expect(graph.truncated).toBe(false);
		expect(graph.steps.map((step) => step.timeMs)).toEqual([1_000, 4_000]);
		expect(graph.steps[0].index).toBe(0);
		expect(graph.steps[1].index).toBe(1);
		// First step advances, final step does not.
		expect(graph.steps[0].advance).toEqual({ cx: 0.2, cy: 0.4 });
		expect(graph.steps[1].advance).toBeNull();
	});

	it("counts double-clicks and right-clicks as explicit steps", () => {
		const graph = deriveDemoStepGraph({
			cursorTelemetry: [
				click(500, 0.3, 0.3, "double-click"),
				click(2_000, 0.5, 0.5, "right-click"),
			],
			totalMs: TOTAL_MS,
		});

		expect(graph.status).toBe("ok");
		expect(graph.steps).toHaveLength(2);
	});

	it("reports no-telemetry for empty or invalid telemetry", () => {
		expect(deriveDemoStepGraph({ cursorTelemetry: [], totalMs: TOTAL_MS }).status).toBe(
			"no-telemetry",
		);
		expect(
			deriveDemoStepGraph({
				cursorTelemetry: [click(Number.NaN, 0.5, 0.5)],
				totalMs: Number.NaN,
			}).status,
		).toBe("no-telemetry");
	});

	it("reports no-interactions when only dwell movement exists", () => {
		const graph = deriveDemoStepGraph({
			cursorTelemetry: [
				move(0, 0.1, 0.1),
				move(500, 0.11, 0.1),
				move(1_000, 0.12, 0.1),
			],
			totalMs: TOTAL_MS,
		});

		expect(graph.status).toBe("no-interactions");
		expect(graph.steps).toEqual([]);
	});
});

describe("deriveDemoStepGraph — dedup", () => {
	it("merges a rapid click pair into one step (no duplicates)", () => {
		const graph = deriveDemoStepGraph({
			cursorTelemetry: [
				click(1_000, 0.4, 0.4),
				click(1_250, 0.42, 0.41),
				click(9_000, 0.6, 0.6),
			],
			totalMs: TOTAL_MS,
		});

		expect(graph.status).toBe("ok");
		expect(graph.steps).toHaveLength(2);
		expect(graph.steps[0].timeMs).toBe(1_000);
		expect(DEMO_STEP_MERGE_GAP_MS).toBeGreaterThan(0);
	});

	it("keeps well-separated clicks as separate steps", () => {
		const graph = deriveDemoStepGraph({
			cursorTelemetry: [
				click(1_000, 0.4, 0.4),
				click(1_050, 0.41, 0.4),
				click(5_000, 0.6, 0.6),
				click(5_060, 0.61, 0.6),
				click(9_000, 0.8, 0.8),
			],
			totalMs: TOTAL_MS,
		});

		expect(graph.steps).toHaveLength(3);
	});
});

describe("deriveDemoStepGraph — cap", () => {
	it("truncates to the configured step cap and reports it", () => {
		const clicks = Array.from({ length: 12 }, (_, index) =>
			click(1_000 + index * 2_000, 0.2 + index * 0.01, 0.5),
		);
		const graph = deriveDemoStepGraph({
			cursorTelemetry: clicks,
			totalMs: TOTAL_MS,
			maxSteps: 5,
		});

		expect(graph.status).toBe("ok");
		expect(graph.steps).toHaveLength(5);
		expect(graph.truncated).toBe(true);
		expect(graph.steps[4].advance).toBeNull();
	});

	it("does not report truncation below the cap", () => {
		const graph = deriveDemoStepGraph({
			cursorTelemetry: [click(1_000, 0.2, 0.2), click(4_000, 0.5, 0.5)],
			totalMs: TOTAL_MS,
			maxSteps: 10,
		});

		expect(graph.truncated).toBe(false);
		expect(DEFAULT_DEMO_STEP_CAP).toBeGreaterThan(0);
	});
});

describe("deriveDemoStepGraph — geometry parity with mapCursorToCanvasNormalized", () => {
	const contentRect = { x: 100, y: 50, width: 800, height: 450 };

	it("matches mapCursorToCanvasNormalized exactly when a content rect is set", () => {
		const graph = deriveDemoStepGraph({
			cursorTelemetry: [click(1_000, 0.25, 0.75), click(4_000, 0.8, 0.1)],
			totalMs: TOTAL_MS,
			contentRect,
			canvasWidth: 1_600,
			canvasHeight: 900,
		});

		const expected = mapCursorToCanvasNormalized(
			{ cx: 0.25, cy: 0.75 },
			{ maskRect: contentRect, canvasWidth: 1_600, canvasHeight: 900 },
		);
		expect(graph.steps[0].advance).not.toBeNull();
		expect(graph.steps[0].advance!.cx).toBe(expected!.cx);
		expect(graph.steps[0].advance!.cy).toBe(expected!.cy);
	});

	it("applies the identity clamp without a content rect", () => {
		const graph = deriveDemoStepGraph({
			cursorTelemetry: [click(1_000, -0.2, 1.4), click(4_000, 0.5, 0.5)],
			totalMs: TOTAL_MS,
		});

		expect(graph.steps[0].advance).toEqual({ cx: 0, cy: 1 });
	});
});

describe("deriveDemoStepGraph — fast-check invariants", () => {
	it("keeps hotspots in frame, order preserved, chain fully linked", () => {
		fc.assert(
			fc.property(
				fc.integer({ min: 1, max: 30 }),
				fc.integer({ min: 1, max: 60 }),
				fc.integer({ min: 1, max: 0x7fffffff }),
				(clickCount, maxSteps, seed) => {
					// Tiny deterministic LCG so failures reproduce for the seed.
					let state = seed || 1;
					const nextInt = () => {
						state = (state * 1_664_525 + 1_013_904_223) % 0x1_0000_0000;
						return state;
					};

					const samples: CursorTelemetryPoint[] = [];
					let timeMs = 200;
					for (let index = 0; index < clickCount; index += 1) {
						// Alternate signed ranges so clamping is exercised too.
						const cx = ((nextInt() % 1_400) - 200) / 1_000;
						const cy = ((nextInt() % 1_400) - 200) / 1_000;
						samples.push(click(timeMs, cx, cy));
						timeMs += 1_200 + (nextInt() % 2_000);
					}
					const totalMs = timeMs + 1_000;

					const graph = deriveDemoStepGraph({
						cursorTelemetry: samples,
						totalMs,
						maxSteps,
					});

					expect(graph.status).toBe("ok");
					expect(graph.steps.length).toBeGreaterThan(0);
					expect(graph.steps.length).toBeLessThanOrEqual(Math.min(clickCount, maxSteps));

					for (let index = 0; index < graph.steps.length; index += 1) {
						const step = graph.steps[index];
						const isLast = index === graph.steps.length - 1;
						// No duplicate steps: strictly increasing times.
						if (index > 0) {
							expect(step.timeMs).toBeGreaterThan(graph.steps[index - 1].timeMs);
						}
						if (isLast) {
							expect(step.advance).toBeNull();
						} else {
							// No unreachable step: every non-final step advances.
							expect(step.advance).not.toBeNull();
							expect(step.advance!.cx).toBeGreaterThanOrEqual(0);
							expect(step.advance!.cx).toBeLessThanOrEqual(1);
							expect(step.advance!.cy).toBeGreaterThanOrEqual(0);
							expect(step.advance!.cy).toBeLessThanOrEqual(1);
						}
					}
				},
			),
			{ numRuns: 50 },
		);
	});
});
