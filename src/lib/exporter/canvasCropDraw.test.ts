// @vitest-environment jsdom
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { CanvasCropApplier } from "./canvasCropDraw";

/**
 * jsdom has no pixel pipeline: every created canvas gets a recording 2D
 * context, so the crop offset math is asserted through the drawImage calls.
 */
const drawImage = vi.fn();

beforeEach(() => {
	drawImage.mockClear();
	const originalCreateElement = document.createElement.bind(document);
	vi.spyOn(document, "createElement").mockImplementation(((tagName, options) => {
		const element = originalCreateElement(tagName, options);
		if (String(tagName).toLowerCase() === "canvas") {
			Object.defineProperty(element, "getContext", {
				configurable: true,
				value: () => ({ drawImage }),
			});
		}
		return element;
	}) as typeof document.createElement);
});

afterEach(() => {
	vi.restoreAllMocks();
});

function createRecordingCanvas(width: number, height: number) {
	const canvas = document.createElement("canvas");
	canvas.width = width;
	canvas.height = height;
	return canvas;
}

describe("CanvasCropApplier", () => {
	it("returns the source unchanged when no crop is configured", () => {
		const applier = new CanvasCropApplier();
		const canvas = createRecordingCanvas(64, 32);
		expect(applier.apply(canvas, undefined)).toBe(canvas);
		expect(applier.apply(canvas, null)).toBe(canvas);
		expect(drawImage).not.toHaveBeenCalled();
	});

	it("copies exactly the crop rect using the source offset", () => {
		const applier = new CanvasCropApplier();
		const canvas = createRecordingCanvas(100, 100);

		const cropped = applier.apply(canvas, { x: 30, y: 40, width: 60, height: 50 });

		expect(cropped).not.toBe(canvas);
		expect(cropped.width).toBe(60);
		expect(cropped.height).toBe(50);
		expect(drawImage).toHaveBeenCalledTimes(1);
		// Source rect = the crop rect inside the composition; destination =
		// the full output canvas starting at 0,0. This is the crop offset math
		// every frame capture goes through.
		expect(drawImage).toHaveBeenCalledWith(canvas, 30, 40, 60, 50, 0, 0, 60, 50);
	});

	it("reuses the cache canvas while the crop size is unchanged and re-sizes when it changes", () => {
		const applier = new CanvasCropApplier();
		const canvas = createRecordingCanvas(80, 80);

		const first = applier.apply(canvas, { x: 10, y: 10, width: 40, height: 40 });
		const second = applier.apply(canvas, { x: 20, y: 5, width: 40, height: 40 });
		expect(second).toBe(first);
		// Same-size crops keep the cache; only the source offset differs.
		expect(drawImage).toHaveBeenLastCalledWith(canvas, 20, 5, 40, 40, 0, 0, 40, 40);

		const resized = applier.apply(canvas, { x: 0, y: 0, width: 20, height: 72 });
		expect(resized).not.toBe(first);
		expect(resized.width).toBe(20);
		expect(resized.height).toBe(72);
	});

	it("releases the cache canvas on dispose", () => {
		const applier = new CanvasCropApplier();
		const canvas = createRecordingCanvas(80, 80);
		const first = applier.apply(canvas, { x: 0, y: 0, width: 40, height: 40 });
		applier.dispose();
		const after = applier.apply(canvas, { x: 0, y: 0, width: 40, height: 40 });
		expect(after).not.toBe(first);
	});
});
