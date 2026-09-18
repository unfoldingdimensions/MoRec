import type { ExportMp4FrameRate, ExportQuality } from "@/lib/exporter";
import { type AspectRatio, getAspectRatioValue } from "@/utils/aspectRatioUtils";

/**
 * Export-time social canvas. Unlike the editor `AspectRatio` (which reflows
 * the composition), a non-original canvas center-crops the finished
 * composition after quality scaling and after zoom, so the framing the user
 * edited is what gets cropped.
 */
export type ExportCanvas = "original" | "9:16" | "1:1" | "4:5";

export const EXPORT_CANVAS_PRESETS = [
	"original",
	"9:16",
	"1:1",
	"4:5",
] as const satisfies readonly ExportCanvas[];

/** Crop rect in pixels inside the pre-crop composition; dims are the final output size. */
export interface CanvasCropRect {
	x: number;
	y: number;
	width: number;
	height: number;
}

export function normalizeExportCanvas(value: unknown): ExportCanvas {
	return (EXPORT_CANVAS_PRESETS as readonly string[]).includes(value as string)
		? (value as ExportCanvas)
		: "original";
}

function toEvenFloor(value: number): number {
	return Math.max(2, Math.floor(value / 2) * 2);
}

/** Even floor for offsets — unlike dimensions, 0 is a valid crop offset. */
function toEvenOffset(value: number): number {
	return Math.max(0, Math.floor(value / 2) * 2);
}

/**
 * Center-crop rect that reshapes a `width`×`height` composition to the canvas
 * ratio: the constrained axis keeps the full (even) size and the other axis is
 * center-cropped, both dims and offsets even-normalized like
 * `calculateMp4ExportDimensions`. Returns null when no crop is needed
 * ("original", invalid input, or the source already matches the canvas —
 * e.g. a portrait recording passing through "9:16").
 */
export function calculateCanvasCropRect(
	width: number,
	height: number,
	canvas: ExportCanvas,
): CanvasCropRect | null {
	if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
		return null;
	}
	if (canvas === "original") {
		return null;
	}

	const ratio = canvas === "9:16" ? 9 / 16 : canvas === "1:1" ? 1 : 4 / 5;
	const evenWidth = toEvenFloor(width);
	const evenHeight = toEvenFloor(height);
	const cropWidth = Math.min(
		evenWidth,
		evenWidth / evenHeight > ratio ? toEvenFloor(evenHeight * ratio) : evenWidth,
	);
	const cropHeight = Math.min(
		evenHeight,
		evenWidth / evenHeight > ratio ? evenHeight : toEvenFloor(evenWidth / ratio),
	);
	if (cropWidth >= evenWidth && cropHeight >= evenHeight) {
		return null;
	}

	return {
		x: toEvenOffset((evenWidth - cropWidth) / 2),
		y: toEvenOffset((evenHeight - cropHeight) / 2),
		width: cropWidth,
		height: cropHeight,
	};
}

/** Final encoded dimensions for an export config: the crop size when a canvas crop is active. */
export function getCanvasCropOutputSize(dimensions: {
	width: number;
	height: number;
	canvasCrop?: CanvasCropRect | null;
}): { width: number; height: number } {
	if (dimensions.canvasCrop) {
		return { width: dimensions.canvasCrop.width, height: dimensions.canvasCrop.height };
	}
	return { width: dimensions.width, height: dimensions.height };
}

/**
 * Rescale a source-space crop rect into a smaller composition space (the GIF
 * route composes at the size-preset-scaled source, so its crop rect must live
 * in that space). Values are rounded to integers; GIF frames have no even-dim
 * encoder constraint.
 */
export function scaleCanvasCropRect(
	rect: CanvasCropRect,
	scale: { fromWidth: number; fromHeight: number; toWidth: number; toHeight: number },
): CanvasCropRect {
	const scaleX = scale.toWidth / Math.max(1, scale.fromWidth);
	const scaleY = scale.toHeight / Math.max(1, scale.fromHeight);
	const round = (value: number) => Math.max(0, Math.round(value));
	return {
		x: round(rect.x * scaleX),
		y: round(rect.y * scaleY),
		width: Math.max(2, Math.round(rect.width * scaleX)),
		height: Math.max(2, Math.round(rect.height * scaleY)),
	};
}

export type Mp4SupportProbeSnapshot = {
	sourceWidth: number;
	sourceHeight: number;
	targetWidth: number;
	targetHeight: number;
	aspectRatio: AspectRatio;
	frameRate: ExportMp4FrameRate;
};

export function shouldDebounceMp4SupportProbe(
	previous: Mp4SupportProbeSnapshot | null,
	current: Mp4SupportProbeSnapshot,
): boolean {
	if (
		!previous ||
		current.aspectRatio !== "native" ||
		previous.aspectRatio !== current.aspectRatio ||
		previous.frameRate !== current.frameRate ||
		previous.sourceWidth !== current.sourceWidth ||
		previous.sourceHeight !== current.sourceHeight
	) {
		return false;
	}

	return (
		previous.targetWidth !== current.targetWidth ||
		previous.targetHeight !== current.targetHeight
	);
}

function normalizeEvenDimension(value: number): number {
	return Math.max(2, Math.floor(value / 2) * 2);
}

function fitAspectRatioWithinBounds(
	maxWidth: number,
	maxHeight: number,
	aspectRatioValue: number,
): { width: number; height: number } {
	const safeMaxWidth = normalizeEvenDimension(maxWidth);
	const safeMaxHeight = normalizeEvenDimension(maxHeight);
	const safeAspectRatio =
		Number.isFinite(aspectRatioValue) && aspectRatioValue > 0 ? aspectRatioValue : 16 / 9;

	if (safeMaxWidth / safeMaxHeight > safeAspectRatio) {
		const height = safeMaxHeight;
		const width = normalizeEvenDimension(height * safeAspectRatio);
		return { width: Math.min(width, safeMaxWidth), height };
	}

	const width = safeMaxWidth;
	const height = normalizeEvenDimension(width / safeAspectRatio);
	return { width, height: Math.min(height, safeMaxHeight) };
}

export function calculateMp4SourceDimensions(
	sourceWidth: number,
	sourceHeight: number,
	aspectRatio: AspectRatio,
	cropRegion?: { width: number; height: number },
): { width: number; height: number } {
	const useCroppedBounds = aspectRatio === "native";
	const safeSourceWidth = normalizeEvenDimension(
		sourceWidth * (useCroppedBounds ? (cropRegion?.width ?? 1) : 1),
	);
	const safeSourceHeight = normalizeEvenDimension(
		sourceHeight * (useCroppedBounds ? (cropRegion?.height ?? 1) : 1),
	);
	const sourceAspectRatio = safeSourceHeight > 0 ? safeSourceWidth / safeSourceHeight : 16 / 9;
	const aspectRatioValue = getAspectRatioValue(aspectRatio, sourceAspectRatio);

	if (aspectRatio === "native") {
		return { width: safeSourceWidth, height: safeSourceHeight };
	}

	const longSide = Math.max(safeSourceWidth, safeSourceHeight);
	const shortSide = Math.min(safeSourceWidth, safeSourceHeight);
	const maxWidth = aspectRatioValue >= 1 ? longSide : shortSide;
	const maxHeight = aspectRatioValue >= 1 ? shortSide : longSide;

	return fitAspectRatioWithinBounds(maxWidth, maxHeight, aspectRatioValue);
}

export function calculateMp4ExportDimensions(
	baseWidth: number,
	baseHeight: number,
	quality: ExportQuality,
): { width: number; height: number } {
	if (quality === "source") {
		return {
			width: normalizeEvenDimension(baseWidth),
			height: normalizeEvenDimension(baseHeight),
		};
	}

	const qualityScale = quality === "medium" ? 0.6 : quality === "good" ? 0.75 : 0.9;
	return {
		width: normalizeEvenDimension(baseWidth * qualityScale),
		height: normalizeEvenDimension(baseHeight * qualityScale),
	};
}
