// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AnnotationRegion } from "@/components/video-editor/types";
import { renderAnnotations } from "./annotationRenderer";

/**
 * jsdom has no pixel pipeline: every mocked canvas gets a recording 2D
 * context, so the blur/pixelate export paths are asserted through the
 * drawImage calls and ctx.filter values they produce.
 */
const canvasDrawCalls: Array<{ ctx: unknown; args: unknown[] }> = [];
const filterValues: string[] = [];

beforeEach(() => {
	canvasDrawCalls.length = 0;
	filterValues.length = 0;

	const originalCreateElement = document.createElement.bind(document);
	vi.spyOn(document, "createElement").mockImplementation(((tagName, options) => {
		const element = originalCreateElement(tagName, options);
		if (String(tagName).toLowerCase() === "canvas") {
			Object.defineProperty(element, "getContext", {
				configurable: true,
				value: () => ({
					save: () => {},
					restore: () => {},
					drawImage: (...args: unknown[]) => canvasDrawCalls.push({ ctx: element, args }),
					clearRect: () => {},
				}),
			});
		}
		return element;
	}) as typeof document.createElement);
});

afterEach(() => {
	vi.restoreAllMocks();
});

function createRecordingCtx(canvasWidth: number, canvasHeight: number) {
	const canvas = document.createElement("canvas");
	canvas.width = canvasWidth;
	canvas.height = canvasHeight;

	return {
		canvas,
		save: vi.fn(),
		restore: vi.fn(),
		beginPath: vi.fn(),
		clip: vi.fn(),
		rect: vi.fn(),
		roundRect: vi.fn(),
		fillRect: vi.fn(),
		fill: vi.fn(),
		drawImage: vi.fn((...args: unknown[]) => canvasDrawCalls.push({ ctx: "composite", args })),
		clearRect: vi.fn(),
		set filter(value: string) {
			filterValues.push(value);
		},
	} as unknown as CanvasRenderingContext2D & { drawImage: ReturnType<typeof vi.fn> };
}

function blurAnnotation(overrides: Partial<AnnotationRegion> = {}): AnnotationRegion {
	return {
		id: "mask-1",
		startMs: 0,
		endMs: 5000,
		type: "blur",
		content: "",
		position: { x: 0, y: 0 },
		size: { width: 100, height: 100 },
		style: {
			color: "#ffffff",
			backgroundColor: "transparent",
			fontSize: 32,
			fontFamily: "sans-serif",
			fontWeight: "bold",
			fontStyle: "normal",
			textDecoration: "none",
			textAlign: "center",
			borderRadius: 8,
		},
		zIndex: 1,
		blurIntensity: 40,
		...overrides,
	};
}

describe("renderAnnotations pixelate masks", () => {
	it("draws a downscaled→re-upscaled region for maskStyle pixelate", async () => {
		const ctx = createRecordingCtx(1920, 1080);

		await renderAnnotations(ctx, [blurAnnotation({ maskStyle: "pixelate" })], 1920, 1080, 1000);

		// The composite receives one pixelate draw: the re-upscale from the
		// intermediate grid (1920/(40/4) = 192 wide, 1080/10 = 108 tall).
		expect(ctx.drawImage).toHaveBeenCalledTimes(1);
		const upscale = vi.mocked(ctx.drawImage).mock.calls[0];
		const scratch = upscale[0] as HTMLCanvasElement;
		expect(scratch).not.toBe(ctx.canvas);
		expect(scratch.width).toBe(192);
		expect(scratch.height).toBe(108);
		expect(upscale.slice(1)).toEqual([0, 0, 192, 108, 0, 0, 1920, 1080]);

		// The intermediate grid sampled the composite's full-frame region.
		const downscale = canvasDrawCalls.find((call) => call.ctx === scratch);
		expect(downscale?.args).toEqual([ctx.canvas, 0, 0, 1920, 1080, 0, 0, 192, 108]);

		// The blur filter path is not taken for pixelate masks.
		expect(filterValues).toEqual([]);
	});

	it("keeps the blur filter path when maskStyle is missing", async () => {
		const ctx = createRecordingCtx(1920, 1080);

		await renderAnnotations(ctx, [blurAnnotation()], 1920, 1080, 1000);

		// Blur path: a blur(40px) filter draw of the buffered region; no
		// pixelate intermediate grid was produced.
		expect(ctx.drawImage).toHaveBeenCalledTimes(1);
		const blurDraw = vi.mocked(ctx.drawImage).mock.calls[0];
		expect(blurDraw[0]).not.toBe(ctx.canvas);
		expect(blurDraw.slice(1)).toEqual([0, 0]);
		expect(filterValues).toEqual(["blur(40px)"]);

		const bufferDraw = canvasDrawCalls.find((call) => call.ctx !== "composite");
		expect(bufferDraw?.args).toEqual([ctx.canvas, 0, 0, 1920, 1080, 0, 0, 1920, 1080]);
	});
});

describe("renderAnnotations scroll-tracking drift", () => {
	it("renders the mask at the interpolated position for the frame time", async () => {
		const ctx = createRecordingCtx(1920, 1080);
		// Pixelate path samples the exact region rect (the blur path pads its
		// sample for edge blending), so the drift math is directly observable.
		const drifting = blurAnnotation({
			maskStyle: "pixelate",
			position: { x: 0, y: 0 },
			endPosition: { x: 50, y: 0 },
			size: { width: 50, height: 100 },
		});

		const sampledRect = () => {
			const upscale = vi
				.mocked(ctx.drawImage)
				.mock.calls.find((call) => (call[0] as HTMLCanvasElement) !== ctx.canvas);
			const scratch = upscale?.[0] as HTMLCanvasElement;
			return canvasDrawCalls.find((call) => call.ctx === scratch)?.args;
		};

		// Halfway through the span the mask has drifted half its travel
		// (grid: 960/(40/4) = 96 wide, 1080/10 = 108 tall).
		await renderAnnotations(ctx, [drifting], 1920, 1080, 2500);
		expect(sampledRect()).toEqual([ctx.canvas, 480, 0, 960, 1080, 0, 0, 96, 108]);

		// At the span start it sits at position; at the span end it has fully
		// arrived at endPosition (past the span the region is not rendered).
		canvasDrawCalls.length = 0;
		await renderAnnotations(ctx, [drifting], 1920, 1080, 0);
		expect(sampledRect()).toEqual([ctx.canvas, 0, 0, 960, 1080, 0, 0, 96, 108]);

		canvasDrawCalls.length = 0;
		await renderAnnotations(ctx, [drifting], 1920, 1080, 5000);
		expect(sampledRect()).toEqual([ctx.canvas, 960, 0, 960, 1080, 0, 0, 96, 108]);
	});
});
