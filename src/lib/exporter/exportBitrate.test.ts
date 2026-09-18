import { describe, expect, it } from "vitest";
import {
	getMp4ExportBitrate,
	getSourceQualityBitrate,
	getTargetSizeExportBitrate,
	MIN_MP4_BITRATE,
	normalizeTargetSizeMb,
	TARGET_SIZE_CONTAINER_OVERHEAD_FACTOR,
	TARGET_SIZE_VIDEO_BITRATE_SHARE,
} from "./exportBitrate";

describe("export bitrate policy", () => {
	it("keeps source-quality exports at a fuller screen-recording bitrate", () => {
		expect(getSourceQualityBitrate(1920, 1080)).toBe(30_000_000);
		expect(
			getMp4ExportBitrate({
				width: 1920,
				height: 1080,
				frameRate: 30,
				quality: "source",
				encodingMode: "quality",
			}),
		).toBe(30_000_000);
		expect(
			getMp4ExportBitrate({
				width: 1920,
				height: 1080,
				frameRate: 30,
				quality: "source",
				encodingMode: "balanced",
			}),
		).toBe(22_500_000);
	});

	it("raises high-resolution 60fps source-quality exports above the 30fps budget", () => {
		const sharedOptions = {
			width: 2560,
			height: 1440,
			quality: "source" as const,
			encodingMode: "quality" as const,
		};

		const thirtyFpsBitrate = getMp4ExportBitrate({
			...sharedOptions,
			frameRate: 30,
		});
		const sixtyFpsBitrate = getMp4ExportBitrate({
			...sharedOptions,
			frameRate: 60,
		});

		expect(thirtyFpsBitrate).toBe(50_000_000);
		expect(sixtyFpsBitrate).toBeGreaterThan(thirtyFpsBitrate);
		expect(sixtyFpsBitrate).toBe(70_710_678);
	});

	it("keeps modern native static-layout source exports high enough for screen text", () => {
		expect(
			getMp4ExportBitrate({
				width: 1920,
				height: 1080,
				frameRate: 30,
				quality: "source",
				encodingMode: "balanced",
				useModernNativeStaticLayout: true,
			}),
		).toBe(22_500_000);
		expect(
			getMp4ExportBitrate({
				width: 1920,
				height: 1080,
				frameRate: 30,
				quality: "source",
				encodingMode: "quality",
				useModernNativeStaticLayout: true,
			}),
		).toBe(30_000_000);
	});

	it("scales modern native static-layout source exports at 60fps", () => {
		const sharedOptions = {
			width: 1920,
			height: 1080,
			quality: "source" as const,
			encodingMode: "quality" as const,
			useModernNativeStaticLayout: true,
		};

		const thirtyFpsBitrate = getMp4ExportBitrate({
			...sharedOptions,
			frameRate: 30,
		});
		const sixtyFpsBitrate = getMp4ExportBitrate({
			...sharedOptions,
			frameRate: 60,
		});

		expect(thirtyFpsBitrate).toBe(30_000_000);
		expect(sixtyFpsBitrate).toBeGreaterThan(thirtyFpsBitrate);
		expect(sixtyFpsBitrate).toBe(42_426_407);
	});

	it("does not raise fast exports when the requested bitrate is already lower than the cap", () => {
		expect(
			getMp4ExportBitrate({
				width: 1920,
				height: 1080,
				frameRate: 30,
				quality: "source",
				encodingMode: "fast",
				useModernNativeStaticLayout: true,
			}),
		).toBe(3_000_000);
	});

	it("scales the modern native cap with output pixel rate", () => {
		expect(
			getMp4ExportBitrate({
				width: 3840,
				height: 2160,
				frameRate: 30,
				quality: "source",
				encodingMode: "quality",
				useModernNativeStaticLayout: true,
			}),
		).toBe(72_000_000);
	});
});

describe("target-size export bitrate", () => {
	it("derives the video bitrate from the requested size and duration", () => {
		// 100 MB over 60 s: total = 100 * 8388608 / 60 * 0.93 bits/s (~13 Mbps,
		// comfortably above the minimum floor so no clamping applies).
		const result = getTargetSizeExportBitrate({ targetSizeMb: 100, durationSec: 60 });
		const totalBitrate = ((100 * 8 * 1024 * 1024) / 60) * TARGET_SIZE_CONTAINER_OVERHEAD_FACTOR;
		expect(result.totalBitrate).toBeCloseTo(totalBitrate, 0);
		expect(result.videoBitrate).toBe(Math.round(totalBitrate * TARGET_SIZE_VIDEO_BITRATE_SHARE));
		expect(result.estimatedSizeMb).toBeCloseTo(100, 0);
		expect(result.clampedToMinBitrate).toBe(false);
	});

	it("splits the budget 90/10 between video and audio", () => {
		const result = getTargetSizeExportBitrate({ targetSizeMb: 200, durationSec: 300 });
		expect(result.videoBitrate / result.totalBitrate).toBeCloseTo(
			TARGET_SIZE_VIDEO_BITRATE_SHARE,
			6,
		);
	});

	it("clamps to the minimum bitrate floor and reports the smallest achievable size", () => {
		// 1 MB over an hour would need ~2 kbit/s — far below the floor.
		const result = getTargetSizeExportBitrate({ targetSizeMb: 1, durationSec: 3600 });
		expect(result.clampedToMinBitrate).toBe(true);
		expect(result.videoBitrate).toBe(MIN_MP4_BITRATE);
		expect(result.totalBitrate).toBeCloseTo(MIN_MP4_BITRATE / TARGET_SIZE_VIDEO_BITRATE_SHARE, 0);
		expect(result.estimatedSizeMb).toBeGreaterThan(1);
	});

	it("returns the floor bitrate for non-positive durations", () => {
		const result = getTargetSizeExportBitrate({ targetSizeMb: 100, durationSec: 0 });
		expect(result.videoBitrate).toBe(MIN_MP4_BITRATE);
		expect(result.estimatedSizeMb).toBe(0);
	});

	it("normalizes out-of-range target sizes", () => {
		expect(normalizeTargetSizeMb(Number.NaN)).toBe(50);
		expect(normalizeTargetSizeMb(0)).toBe(1);
		expect(normalizeTargetSizeMb(-5)).toBe(1);
		expect(normalizeTargetSizeMb(99_999)).toBe(4096);
		expect(normalizeTargetSizeMb(87.6)).toBe(88);
	});

	it("routes getMp4ExportBitrate through the target-size math when inputs are present", () => {
		const expected = getTargetSizeExportBitrate({ targetSizeMb: 80, durationSec: 120 });
		expect(
			getMp4ExportBitrate({
				width: 1920,
				height: 1080,
				frameRate: 30,
				quality: "target-size",
				encodingMode: "quality",
				useModernNativeStaticLayout: true,
				targetSizeMb: 80,
				durationSec: 120,
			}),
		).toBe(expected.videoBitrate);
	});

	it("falls back to the high-quality budget when target-size inputs are missing", () => {
		expect(
			getMp4ExportBitrate({
				width: 1920,
				height: 1080,
				frameRate: 30,
				quality: "target-size",
				encodingMode: "balanced",
			}),
		).toBe(
			getMp4ExportBitrate({
				width: 1920,
				height: 1080,
				frameRate: 30,
				quality: "high",
				encodingMode: "balanced",
			}),
		);
	});
});
