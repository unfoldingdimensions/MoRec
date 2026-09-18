import { describe, expect, it } from "vitest";
import { resolveExportStartSettings } from "./exportStartSettings";

const baseOptions = {
	sourceWidth: 1920,
	sourceHeight: 1080,
	exportFormat: "mp4" as const,
	includeCaptionSidecar: true,
	exportEncodingMode: "balanced" as const,
	exportQuality: "good" as const,
	targetSizeMb: 50,
	mp4FrameRate: 30 as const,
	exportBackendPreference: "auto" as const,
	exportPipelineModel: "modern" as const,
	gifFrameRate: 20 as const,
	gifLoop: true,
	gifSizePreset: "medium" as const,
};

describe("resolveExportStartSettings", () => {
	it("preserves MP4 dropdown settings", () => {
		expect(resolveExportStartSettings(baseOptions)).toEqual({
			format: "mp4",
			includeCaptionSidecar: true,
			encodingMode: "balanced",
			mp4FrameRate: 30,
			backendPreference: "auto",
			pipelineModel: "modern",
			quality: "good",
			targetSizeMb: 50,
			resume: undefined,
			gifConfig: undefined,
		});
	});

	it("attaches the resume ref for modern MP4 exports", () => {
		const resume = { exportId: "export-1", settingsHash: "abcd1234" };
		expect(
			resolveExportStartSettings({ ...baseOptions, resume }).resume,
		).toEqual(resume);
	});

	it("drops the resume ref for legacy-pipeline MP4 exports", () => {
		const resume = { exportId: "export-1", settingsHash: "abcd1234" };
		expect(
			resolveExportStartSettings({
				...baseOptions,
				exportPipelineModel: "legacy",
				resume,
			}).resume,
		).toBeUndefined();
	});

	it("omits MP4-only fields and resolves GIF dimensions for GIF exports", () => {
		expect(
			resolveExportStartSettings({
				...baseOptions,
				sourceWidth: 2560,
				sourceHeight: 1440,
				exportFormat: "gif",
				gifFrameRate: 15,
				gifLoop: false,
				gifSizePreset: "medium",
			}),
		).toEqual({
			format: "gif",
			includeCaptionSidecar: false,
			encodingMode: undefined,
			mp4FrameRate: undefined,
			backendPreference: undefined,
			pipelineModel: undefined,
			quality: undefined,
			targetSizeMb: undefined,
			resume: undefined,
			gifConfig: {
				frameRate: 15,
				loop: false,
				sizePreset: "medium",
				width: 1280,
				height: 720,
			},
		});
	});

	it("keeps original GIF dimensions when the original preset is selected", () => {
		expect(
			resolveExportStartSettings({
				...baseOptions,
				sourceWidth: 1234,
				sourceHeight: 678,
				exportFormat: "gif",
				gifSizePreset: "original",
			}).gifConfig,
		).toMatchObject({
			sizePreset: "original",
			width: 1234,
			height: 678,
		});
	});
});
