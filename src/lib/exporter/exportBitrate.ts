import type { ExportEncodingMode, ExportMp4FrameRate, ExportQuality } from "./types";

export const MIN_MP4_BITRATE = 2_000_000;
const REFERENCE_PIXEL_RATE = 1920 * 1080 * 30;
const REFERENCE_FRAME_RATE = 30;
/**
 * MP4 container + muxing overhead: ~7% of the file is not A/V payload, so the
 * target-size preset budgets the requested size against this factor.
 */
export const TARGET_SIZE_CONTAINER_OVERHEAD_FACTOR = 0.93;
/**
 * Share of the total target-size bitrate budget given to video; the rest is
 * reserved for the audio track.
 */
export const TARGET_SIZE_VIDEO_BITRATE_SHARE = 0.9;
const BITS_PER_MEGABIT = 8 * 1024 * 1024;
const DEFAULT_TARGET_SIZE_MB = 50;
const MIN_TARGET_SIZE_MB = 1;
const MAX_TARGET_SIZE_MB = 4096;

export function normalizeTargetSizeMb(value: unknown): number {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		return DEFAULT_TARGET_SIZE_MB;
	}

	return Math.min(MAX_TARGET_SIZE_MB, Math.max(MIN_TARGET_SIZE_MB, Math.round(value)));
}

export interface TargetSizeBitrateResult {
	videoBitrate: number;
	/** Video + audio bitrate the estimate is based on, in bits per second. */
	totalBitrate: number;
	estimatedSizeMb: number;
	/** True when the requested target was below the minimum bitrate floor. */
	clampedToMinBitrate: boolean;
}

export function getTargetSizeExportBitrate(options: {
	targetSizeMb: number;
	durationSec: number;
}): TargetSizeBitrateResult {
	const targetSizeMb = normalizeTargetSizeMb(options.targetSizeMb);
	const durationSec =
		Number.isFinite(options.durationSec) && options.durationSec > 0 ? options.durationSec : 0;
	if (durationSec <= 0) {
		return {
			videoBitrate: MIN_MP4_BITRATE,
			totalBitrate: MIN_MP4_BITRATE,
			estimatedSizeMb: 0,
			clampedToMinBitrate: false,
		};
	}

	const requestedTotalBitrate =
		((targetSizeMb * BITS_PER_MEGABIT) / durationSec) * TARGET_SIZE_CONTAINER_OVERHEAD_FACTOR;
	const requestedVideoBitrate = requestedTotalBitrate * TARGET_SIZE_VIDEO_BITRATE_SHARE;
	const clampedToMinBitrate = requestedVideoBitrate < MIN_MP4_BITRATE;
	const videoBitrate = Math.max(MIN_MP4_BITRATE, Math.round(requestedVideoBitrate));
	const totalBitrate = videoBitrate / TARGET_SIZE_VIDEO_BITRATE_SHARE;

	return {
		videoBitrate,
		totalBitrate,
		// The expected file size: A/V payload plus the container overhead share,
		// so an unclamped request estimates back to (approximately) the target.
		estimatedSizeMb:
			(totalBitrate * durationSec) / BITS_PER_MEGABIT / TARGET_SIZE_CONTAINER_OVERHEAD_FACTOR,
		clampedToMinBitrate,
	};
}

export function getEncodingModeBitrateMultiplier(encodingMode: ExportEncodingMode): number {
	switch (encodingMode) {
		case "fast":
			return 0.1;
		case "quality":
			return 1;
		case "balanced":
		default:
			return 0.75;
	}
}

export function getSourceQualityBitrate(width: number, height: number): number {
	const totalPixels = width * height;
	if (totalPixels > 2560 * 1440) {
		return 80_000_000;
	}
	if (totalPixels > 1920 * 1080) {
		return 50_000_000;
	}
	return 30_000_000;
}

function getBaseMp4ExportBitrate(width: number, height: number, quality: ExportQuality): number {
	if (quality === "source") {
		return getSourceQualityBitrate(width, height);
	}

	const totalPixels = width * height;
	if (totalPixels <= 1280 * 720) {
		return 10_000_000;
	}
	if (totalPixels <= 1920 * 1080) {
		return 20_000_000;
	}
	return 30_000_000;
}

function getFrameRateBitrateMultiplier(frameRate: ExportMp4FrameRate): number {
	// This only scales requestedBitrate above REFERENCE_FRAME_RATE, so 24fps
	// and 30fps share the same multiplier. useModernNativeStaticLayout can
	// still change the final bitrate because pixelRateScale uses frameRate
	// against REFERENCE_PIXEL_RATE for the native layout floor/cap.
	return Math.sqrt(Math.max(1, frameRate / REFERENCE_FRAME_RATE));
}

function getModernNativeStaticLayoutBitrateCap(
	width: number,
	height: number,
	frameRate: ExportMp4FrameRate,
	quality: ExportQuality,
): number {
	const referenceCap =
		quality === "source"
			? 36_000_000
			: quality === "high"
				? 28_000_000
				: quality === "good"
					? 20_000_000
					: 14_000_000;
	const pixelRateScale = Math.max((width * height * frameRate) / REFERENCE_PIXEL_RATE, 0.1);
	return Math.round(referenceCap * Math.sqrt(pixelRateScale));
}

function getModernNativeStaticLayoutBitrateFloor(
	width: number,
	height: number,
	frameRate: ExportMp4FrameRate,
	quality: ExportQuality,
): number {
	const referenceFloor =
		quality === "source"
			? 22_000_000
			: quality === "high"
				? 16_000_000
				: quality === "good"
					? 12_000_000
					: 8_000_000;
	const pixelRateScale = Math.max((width * height * frameRate) / REFERENCE_PIXEL_RATE, 0.1);
	return Math.round(referenceFloor * Math.sqrt(pixelRateScale));
}

export function getMp4ExportBitrate(options: {
	width: number;
	height: number;
	frameRate: ExportMp4FrameRate;
	quality: ExportQuality;
	encodingMode: ExportEncodingMode;
	useModernNativeStaticLayout?: boolean;
	targetSizeMb?: number;
	durationSec?: number;
}): number {
	if (options.quality === "target-size") {
		const durationSec = options.durationSec;
		if (
			typeof durationSec === "number" &&
			Number.isFinite(durationSec) &&
			durationSec > 0 &&
			typeof options.targetSizeMb === "number" &&
			Number.isFinite(options.targetSizeMb) &&
			options.targetSizeMb > 0
		) {
			// The whole point of the target-size preset is a predictable file size,
			// so the native floor/cap adjustments are bypassed; only the minimum
			// bitrate floor applies.
			return getTargetSizeExportBitrate({
				targetSizeMb: options.targetSizeMb,
				durationSec,
			}).videoBitrate;
		}
	}

	const requestedBitrate = Math.round(
		getBaseMp4ExportBitrate(options.width, options.height, options.quality) *
			getFrameRateBitrateMultiplier(options.frameRate) *
			getEncodingModeBitrateMultiplier(options.encodingMode),
	);
	const nativeStaticLayoutBitrate =
		options.useModernNativeStaticLayout && options.encodingMode !== "fast"
			? Math.max(
					requestedBitrate,
					getModernNativeStaticLayoutBitrateFloor(
						options.width,
						options.height,
						options.frameRate,
						options.quality,
					),
				)
			: requestedBitrate;
	const cappedBitrate = options.useModernNativeStaticLayout
		? Math.min(
				nativeStaticLayoutBitrate,
				getModernNativeStaticLayoutBitrateCap(
					options.width,
					options.height,
					options.frameRate,
					options.quality,
				),
			)
		: requestedBitrate;

	return Math.max(MIN_MP4_BITRATE, cappedBitrate);
}
