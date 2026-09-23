/**
 * Shared pixelate math for privacy-mask annotations.
 *
 * The editor overlay and the export annotation renderer must produce the same
 * effect, so both call these functions instead of reimplementing the
 * downscale/re-upscale trick: the region is drawn into a tiny intermediate
 * canvas (averaging pixels), then scaled back up with image smoothing disabled
 * so each intermediate pixel becomes a hard block.
 */

export type PixelateSource = HTMLCanvasElement | HTMLImageElement | HTMLVideoElement | ImageBitmap;

export interface PixelateRegionRect {
	x: number;
	y: number;
	width: number;
	height: number;
}

/**
 * Map a mask intensity (1–100, the same scale as blurIntensity) to the pixel
 * block size in destination pixels. Higher intensity → larger blocks. The
 * scaleFactor converts annotation-space pixels to the target canvas (e.g.
 * export resolution vs. the 1920×1080 preview base).
 */
export function getPixelateBlockSize(intensity: number, scaleFactor = 1): number {
	const clamped = Math.min(100, Math.max(1, Number.isFinite(intensity) ? intensity : 20));
	return Math.max(1, Math.round((clamped / 4) * scaleFactor));
}

/** Dimensions of the intermediate downscale surface for a region. */
export function getPixelateIntermediateSize(
	width: number,
	height: number,
	blockSize: number,
): { width: number; height: number } {
	const safeBlock = Math.max(1, blockSize);
	return {
		width: Math.max(1, Math.floor(width / safeBlock)),
		height: Math.max(1, Math.floor(height / safeBlock)),
	};
}

let pixelateScratchCanvas: HTMLCanvasElement | null = null;
function getScratchCanvas(): HTMLCanvasElement | null {
	if (typeof document === "undefined") return null;
	if (!pixelateScratchCanvas) {
		pixelateScratchCanvas = document.createElement("canvas");
	}
	return pixelateScratchCanvas;
}

/**
 * Draw `source`'s region onto `dest` pixelated. `sourceRect` and `destRect`
 * may differ (the editor samples a higher-resolution frame than it displays);
 * the block grid is derived from the destination size so the visible block
 * count stays stable across resolutions.
 *
 * `dest` smoothing state is saved/restored; the intermediate downscale always
 * averages with smoothing on, the final upscale always hardens with smoothing
 * off.
 */
export function drawPixelatedRegion(params: {
	source: PixelateSource;
	sourceRect: PixelateRegionRect;
	dest: CanvasRenderingContext2D;
	destRect: PixelateRegionRect;
	blockSize: number;
}): void {
	const { source, sourceRect, dest, destRect, blockSize } = params;
	if (sourceRect.width <= 0 || sourceRect.height <= 0) return;
	if (destRect.width <= 0 || destRect.height <= 0) return;

	const intermediate = getPixelateIntermediateSize(destRect.width, destRect.height, blockSize);
	const scratch = getScratchCanvas();
	if (!scratch) return;

	scratch.width = intermediate.width;
	scratch.height = intermediate.height;
	const scratchCtx = scratch.getContext("2d");
	if (!scratchCtx) return;

	scratchCtx.imageSmoothingEnabled = true;
	scratchCtx.clearRect(0, 0, scratch.width, scratch.height);
	scratchCtx.drawImage(
		source,
		sourceRect.x,
		sourceRect.y,
		sourceRect.width,
		sourceRect.height,
		0,
		0,
		scratch.width,
		scratch.height,
	);

	dest.save();
	dest.imageSmoothingEnabled = false;
	dest.drawImage(
		scratch,
		0,
		0,
		scratch.width,
		scratch.height,
		destRect.x,
		destRect.y,
		destRect.width,
		destRect.height,
	);
	dest.restore();
}
