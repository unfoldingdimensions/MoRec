import { describe, expect, it } from "vitest";
import {
	hasAnnotationDrift,
	resolveAnnotationPosition,
} from "./annotationDrift";

const base = { startMs: 1000, endMs: 5000, position: { x: 10, y: 80 } };

describe("resolveAnnotationPosition", () => {
	it("returns the base position when no end position is set", () => {
		expect(resolveAnnotationPosition(base, 3000)).toEqual({ x: 10, y: 80 });
		expect(resolveAnnotationPosition({ ...base, endPosition: undefined }, 5000)).toEqual({
			x: 10,
			y: 80,
		});
	});

	it("interpolates linearly across the span", () => {
		const region = { ...base, endPosition: { x: 50, y: 40 } };
		expect(resolveAnnotationPosition(region, 1000)).toEqual({ x: 10, y: 80 });
		expect(resolveAnnotationPosition(region, 3000)).toEqual({ x: 30, y: 60 });
		expect(resolveAnnotationPosition(region, 5000)).toEqual({ x: 50, y: 40 });
	});

	it("clamps to the endpoints outside the span", () => {
		const region = { ...base, endPosition: { x: 50, y: 40 } };
		expect(resolveAnnotationPosition(region, 0)).toEqual({ x: 10, y: 80 });
		expect(resolveAnnotationPosition(region, 9000)).toEqual({ x: 50, y: 40 });
	});

	it("returns the base position for a zero-length or invalid span", () => {
		const region = {
			startMs: 2000,
			endMs: 2000,
			position: { x: 10, y: 80 },
			endPosition: { x: 50, y: 40 },
		};
		expect(resolveAnnotationPosition(region, 2000)).toEqual({ x: 10, y: 80 });
		expect(
			resolveAnnotationPosition(
				{ startMs: 5000, endMs: 1000, position: base.position, endPosition: base.position },
				3000,
			),
		).toEqual({ x: 10, y: 80 });
	});
});

describe("hasAnnotationDrift", () => {
	it("is false without an end position and true only when it differs", () => {
		expect(hasAnnotationDrift(base)).toBe(false);
		expect(hasAnnotationDrift({ ...base, endPosition: { x: 10, y: 80 } })).toBe(false);
		expect(hasAnnotationDrift({ ...base, endPosition: { x: 10, y: 40 } })).toBe(true);
	});
});
