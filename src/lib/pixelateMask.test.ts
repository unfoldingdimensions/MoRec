// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	drawPixelatedRegion,
	getPixelateBlockSize,
	getPixelateIntermediateSize,
} from "./pixelateMask";

/**
 * jsdom has no pixel pipeline: created canvases get a recording 2D context,
 * so the downscale/upscale math is asserted through the drawImage calls and
 * the smoothing flag flips that produce the hard block grid.
 */
const scratchCalls: Array<{
	method: string;
	args: unknown[];
	smoothing: boolean | null;
}> = [];

let destSmoothing: boolean | null = null;
const destDrawImage = vi.fn();
const destClearRect = vi.fn();

function recordingContext() {
	return {
		save: () => {},
		restore: () => {},
		drawImage: (...args: unknown[]) => {
			scratchCalls.push({ method: "drawImage", args, smoothing: destSmoothing });
		},
		// Not recorded: only the drawImage pair (downscale/upscale) matters.
		clearRect: () => {},
		set imageSmoothingEnabled(value: boolean) {
			destSmoothing = value;
		},
		get imageSmoothingEnabled() {
			return destSmoothing ?? false;
		},
	};
}

beforeEach(() => {
	scratchCalls.length = 0;
	destDrawImage.mockClear();
	destClearRect.mockClear();
	destSmoothing = null;

	const originalCreateElement = document.createElement.bind(document);
	vi.spyOn(document, "createElement").mockImplementation(((tagName, options) => {
		const element = originalCreateElement(tagName, options);
		if (String(tagName).toLowerCase() === "canvas") {
			Object.defineProperty(element, "getContext", {
				configurable: true,
				value: () => recordingContext(),
			});
		}
		return element;
	}) as typeof document.createElement);
});

afterEach(() => {
	vi.restoreAllMocks();
});

function createCanvas(width: number, height: number) {
	const canvas = document.createElement("canvas");
	canvas.width = width;
	canvas.height = height;
	return canvas;
}

describe("getPixelateBlockSize", () => {
	it("maps intensity to a block grid: intensity/4 canvas px", () => {
		expect(getPixelateBlockSize(20)).toBe(5);
		expect(getPixelateBlockSize(60)).toBe(15);
		expect(getPixelateBlockSize(100)).toBe(25);
	});

	it("scales with the annotation→canvas scale factor", () => {
		expect(getPixelateBlockSize(20, 2)).toBe(10);
		expect(getPixelateBlockSize(60, 0.5)).toBe(8); // round(30 * 0.5)
	});

	it("clamps and falls back instead of producing zero or negative blocks", () => {
		expect(getPixelateBlockSize(0)).toBe(1);
		expect(getPixelateBlockSize(-50)).toBe(1);
		expect(getPixelateBlockSize(1000)).toBe(25);
		expect(getPixelateBlockSize(Number.NaN)).toBe(5);
	});
});

describe("getPixelateIntermediateSize", () => {
	it("divides the region into blockSize cells, minimum 1×1", () => {
		expect(getPixelateIntermediateSize(100, 80, 5)).toEqual({ width: 20, height: 16 });
		expect(getPixelateIntermediateSize(7, 3, 5)).toEqual({ width: 1, height: 1 });
		expect(getPixelateIntermediateSize(0, 0, 5)).toEqual({ width: 1, height: 1 });
	});
});

describe("drawPixelatedRegion", () => {
	it("downsamples the region then re-upscales with smoothing disabled", () => {
		const source = createCanvas(1920, 1080);

		drawPixelatedRegion({
			source,
			sourceRect: { x: 0, y: 0, width: 1920, height: 1080 },
			dest: recordingContext() as unknown as CanvasRenderingContext2D,
			destRect: { x: 0, y: 0, width: 1920, height: 1080 },
			blockSize: 10,
		});

		// Downscale into the 192×108 intermediate grid (blockSize 10).
		const downscale = scratchCalls[0];
		expect(downscale.method).toBe("drawImage");
		expect(downscale.args).toEqual([source, 0, 0, 1920, 1080, 0, 0, 192, 108]);

		// Upscale from the intermediate grid back to full size…
		const upscale = scratchCalls[1];
		expect(upscale.method).toBe("drawImage");
		expect(upscale.args[0]).not.toBe(source); // …from the scratch canvas
		expect(upscale.args.slice(1)).toEqual([0, 0, 192, 108, 0, 0, 1920, 1080]);
		// …with image smoothing disabled so each cell hardens into a block.
		expect(upscale.smoothing).toBe(false);
	});

	it("maps a sub-region of a higher-resolution source onto the dest rect", () => {
		const source = createCanvas(3840, 2160);

		drawPixelatedRegion({
			source,
			sourceRect: { x: 480, y: 270, width: 960, height: 540 },
			dest: recordingContext() as unknown as CanvasRenderingContext2D,
			destRect: { x: 10, y: 20, width: 480, height: 270 },
			blockSize: 5,
		});

		expect(scratchCalls[0].args).toEqual([source, 480, 270, 960, 540, 0, 0, 96, 54]);
		expect(scratchCalls[1].args.slice(1)).toEqual([0, 0, 96, 54, 10, 20, 480, 270]);
	});

	it("is a no-op for empty regions", () => {
		drawPixelatedRegion({
			source: createCanvas(100, 100),
			sourceRect: { x: 0, y: 0, width: 0, height: 0 },
			dest: recordingContext() as unknown as CanvasRenderingContext2D,
			destRect: { x: 0, y: 0, width: 100, height: 100 },
			blockSize: 5,
		});
		drawPixelatedRegion({
			source: createCanvas(100, 100),
			sourceRect: { x: 0, y: 0, width: 100, height: 100 },
			dest: recordingContext() as unknown as CanvasRenderingContext2D,
			destRect: { x: 0, y: 0, width: 0, height: 100 },
			blockSize: 5,
		});

		expect(scratchCalls).toHaveLength(0);
	});
});
