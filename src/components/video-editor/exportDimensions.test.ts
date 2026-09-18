import { describe, expect, it } from "vitest";
import type { ExportQuality } from "@/lib/exporter";
import {
	calculateCanvasCropRect,
	calculateMp4ExportDimensions,
	calculateMp4SourceDimensions,
	getCanvasCropOutputSize,
	normalizeExportCanvas,
	shouldDebounceMp4SupportProbe,
} from "./exportDimensions";

describe("calculateMp4SourceDimensions", () => {
	it("keeps native exports at the source dimensions", () => {
		expect(calculateMp4SourceDimensions(1920, 1080, "native")).toEqual({
			width: 1920,
			height: 1080,
		});
	});

	it("uses the cropped source bounds for native exports", () => {
		expect(
			calculateMp4SourceDimensions(320, 180, "native", {
				width: 1,
				height: 0.8,
			}),
		).toEqual({
			width: 320,
			height: 144,
		});
	});

	it("uses the rotated source bounds for 9:16 original exports", () => {
		expect(calculateMp4SourceDimensions(1920, 1080, "9:16")).toEqual({
			width: 1080,
			height: 1920,
		});
	});

	it("ignores crop bounds for fixed-aspect exports", () => {
		expect(
			calculateMp4SourceDimensions(1920, 1080, "9:16", {
				width: 0.5,
				height: 0.5,
			}),
		).toEqual({
			width: 1080,
			height: 1920,
		});
	});

	it("uses the rotated source bounds for portrait social ratios", () => {
		expect(calculateMp4SourceDimensions(1920, 1080, "4:5")).toEqual({
			width: 1080,
			height: 1350,
		});
	});

	it("keeps landscape aspect-ratio exports inside the source bounds", () => {
		expect(calculateMp4SourceDimensions(1920, 1080, "4:3")).toEqual({
			width: 1440,
			height: 1080,
		});
	});
});

describe("calculateMp4ExportDimensions", () => {
	it("normalizes odd source dimensions to even export dimensions", () => {
		const sourceDimensions = calculateMp4SourceDimensions(1919, 1079, "native");

		expect(sourceDimensions).toEqual({
			width: 1918,
			height: 1078,
		});
		expect(
			calculateMp4ExportDimensions(sourceDimensions.width, sourceDimensions.height, "source"),
		).toEqual({
			width: 1918,
			height: 1078,
		});
		expect(
			calculateMp4ExportDimensions(sourceDimensions.width, sourceDimensions.height, "high"),
		).toEqual({
			width: 1726,
			height: 970,
		});
	});

	it("scales portrait output dimensions from the aspect target", () => {
		const sourceDimensions = calculateMp4SourceDimensions(1920, 1080, "9:16");

		expect(
			calculateMp4ExportDimensions(sourceDimensions.width, sourceDimensions.height, "source"),
		).toEqual({
			width: 1080,
			height: 1920,
		});
		expect(
			calculateMp4ExportDimensions(sourceDimensions.width, sourceDimensions.height, "high"),
		).toEqual({
			width: 972,
			height: 1728,
		});
	});
});

describe("calculateCanvasCropRect", () => {
	it("returns null for original canvas", () => {
		expect(calculateCanvasCropRect(1920, 1080, "original")).toBeNull();
		expect(calculateCanvasCropRect(1920, 1080, normalizeExportCanvas("bogus"))).toBeNull();
	});

	it("returns null for invalid dimensions", () => {
		expect(calculateCanvasCropRect(0, 1080, "1:1")).toBeNull();
		expect(calculateCanvasCropRect(1920, Number.NaN, "1:1")).toBeNull();
	});

	it("center-crops a landscape composition to 9:16 with even rect and offsets", () => {
		expect(calculateCanvasCropRect(1920, 1080, "9:16")).toEqual({
			x: 656,
			y: 0,
			width: 606,
			height: 1080,
		});
	});

	it("center-crops to 1:1 and 4:5", () => {
		expect(calculateCanvasCropRect(1920, 1080, "1:1")).toEqual({
			x: 420,
			y: 0,
			width: 1080,
			height: 1080,
		});
		expect(calculateCanvasCropRect(1920, 1080, "4:5")).toEqual({
			x: 528,
			y: 0,
			width: 864,
			height: 1080,
		});
	});

	it("passes a portrait source through 9:16 untouched", () => {
		expect(calculateCanvasCropRect(1080, 1920, "9:16")).toBeNull();
	});

	it("crops the vertical axis for landscape canvases from portrait sources", () => {
		expect(calculateCanvasCropRect(1080, 1920, "4:5")).toEqual({
			x: 0,
			y: 284,
			width: 1080,
			height: 1350,
		});
	});

	it("handles odd source dimensions with even normalization", () => {
		const rect = calculateCanvasCropRect(1919, 1079, "1:1");
		expect(rect).toEqual({ x: 420, y: 0, width: 1078, height: 1078 });
	});
});

describe("canvas × quality dimension matrix", () => {
	const qualities: ExportQuality[] = ["medium", "good", "high", "source"];

	it("applies the canvas after quality scaling (even dims, centered rect)", () => {
		// 1920x1080 source, "high" quality scales to 1728x972; 9:16 crops it.
		const qualityDims = calculateMp4ExportDimensions(1920, 1080, "high");
		expect(qualityDims).toEqual({ width: 1728, height: 972 });

		const rect = calculateCanvasCropRect(qualityDims.width, qualityDims.height, "9:16");
		expect(rect).toEqual({ x: 590, y: 0, width: 546, height: 972 });

		// The crop rect must sit inside the composition and be even.
		for (const quality of qualities) {
			const dims = calculateMp4ExportDimensions(1920, 1080, quality);
			const crop = calculateCanvasCropRect(dims.width, dims.height, "1:1");
			expect(crop).not.toBeNull();
			expect(crop!.width % 2).toBe(0);
			expect(crop!.height % 2).toBe(0);
			expect(crop!.x % 2).toBe(0);
			expect(crop!.y % 2).toBe(0);
			expect(crop!.x + crop!.width).toBeLessThanOrEqual(dims.width);
			expect(crop!.y + crop!.height).toBeLessThanOrEqual(dims.height);
			expect(Math.abs(crop!.width / crop!.height - 1)).toBeLessThan(0.02);
		}
	});

	it("keeps original canvas output equal to quality dims", () => {
		const dims = calculateMp4ExportDimensions(1920, 1080, "good");
		expect(getCanvasCropOutputSize({ ...dims })).toEqual(dims);
	});

	it("reports the crop size as the final output size", () => {
		const crop = calculateCanvasCropRect(1920, 1080, "1:1");
		expect(
			getCanvasCropOutputSize({ width: 1920, height: 1080, canvasCrop: crop }),
		).toEqual({ width: 1080, height: 1080 });
	});
});
describe("shouldDebounceMp4SupportProbe", () => {
	const baseSnapshot = {
		sourceWidth: 1920,
		sourceHeight: 1080,
		targetWidth: 1920,
		targetHeight: 1080,
		aspectRatio: "native" as const,
		frameRate: 30 as const,
	};

	it("debounces only native crop-driven target changes", () => {
		expect(
			shouldDebounceMp4SupportProbe(baseSnapshot, {
				...baseSnapshot,
				targetHeight: 864,
			}),
		).toBe(true);
	});

	it("keeps non-crop probe changes immediate", () => {
		expect(shouldDebounceMp4SupportProbe(null, baseSnapshot)).toBe(false);
		expect(
			shouldDebounceMp4SupportProbe(baseSnapshot, {
				...baseSnapshot,
				frameRate: 60,
			}),
		).toBe(false);
		expect(
			shouldDebounceMp4SupportProbe(baseSnapshot, {
				...baseSnapshot,
				sourceWidth: 1280,
				sourceHeight: 720,
				targetWidth: 1280,
				targetHeight: 720,
			}),
		).toBe(false);
		expect(
			shouldDebounceMp4SupportProbe(baseSnapshot, {
				...baseSnapshot,
				aspectRatio: "16:9",
			}),
		).toBe(false);
	});
});
