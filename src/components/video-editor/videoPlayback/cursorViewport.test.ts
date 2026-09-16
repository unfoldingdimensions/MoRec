import { describe, expect, it } from "vitest";

import { buildCursorFollowTelemetry, projectCursorPositionToViewport } from "./cursorViewport";

describe("projectCursorPositionToViewport", () => {
	it("leaves coordinates unchanged when no crop is active", () => {
		expect(projectCursorPositionToViewport({ cx: 0.25, cy: 0.75 })).toEqual({
			cx: 0.25,
			cy: 0.75,
			visible: true,
		});
	});

	it("remaps source-space coordinates into crop-relative viewport space", () => {
		const projected = projectCursorPositionToViewport(
			{ cx: 0.3, cy: 0.55 },
			{ x: 0.2, y: 0.4, width: 0.5, height: 0.4 },
		);

		expect(projected.visible).toBe(true);
		expect(projected.cx).toBeCloseTo(0.2, 6);
		expect(projected.cy).toBeCloseTo(0.375, 6);
	});

	it("marks cursor invisible when it falls outside the cropped source region", () => {
		expect(
			projectCursorPositionToViewport(
				{ cx: 0.1, cy: 0.5 },
				{ x: 0.2, y: 0.25, width: 0.5, height: 0.5 },
			),
		).toEqual({
			cx: -0.2,
			cy: 0.5,
			visible: false,
		});
	});
});

describe("buildCursorFollowTelemetry", () => {
	it("returns the same array untouched when no crop or the default crop is active", () => {
		const samples = [{ timeMs: 0, cx: 0.3, cy: 0.55, cursorType: "arrow" as const }];

		expect(buildCursorFollowTelemetry(samples, undefined)).toBe(samples);
		expect(buildCursorFollowTelemetry(samples, { x: 0, y: 0, width: 1, height: 1 })).toBe(
			samples,
		);
	});

	it("projects sample coordinates into crop-viewport space and keeps other fields", () => {
		const samples = [
			{ timeMs: 0, cx: 0.3, cy: 0.55, cursorType: "pointer" as const },
			{ timeMs: 16, cx: 0.45, cy: 0.6, cursorType: "pointer" as const },
		];

		const projected = buildCursorFollowTelemetry(samples, {
			x: 0.2,
			y: 0.4,
			width: 0.5,
			height: 0.4,
		});

		expect(projected).not.toBe(samples);
		expect(projected).toHaveLength(2);
		expect(projected[0]?.cx).toBeCloseTo(0.2, 6);
		expect(projected[0]?.cy).toBeCloseTo(0.375, 6);
		expect(projected[1]?.cx).toBeCloseTo(0.5, 6);
		expect(projected[1]?.cy).toBeCloseTo(0.5, 6);
		expect(projected[0]?.cursorType).toBe("pointer");
		expect(projected[0]?.timeMs).toBe(0);
	});
});
