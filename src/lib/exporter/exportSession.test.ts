import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ExportSettings } from "./types";
import {
	clearPendingResumableExport,
	computeExportSettingsHash,
	loadPendingResumableExport,
	resolveResumableExportBanner,
	savePendingResumableExport,
	type PendingResumableExport,
} from "./exportSession";

const VIDEO_PATH = "/videos/demo.mp4";

function settings(overrides: Partial<ExportSettings> = {}): ExportSettings {
	return {
		format: "mp4",
		quality: "high",
		encodingMode: "balanced",
		mp4FrameRate: 30,
		backendPreference: "auto",
		pipelineModel: "modern",
		...overrides,
	};
}

function pending(overrides: Partial<PendingResumableExport> = {}): PendingResumableExport {
	const settingsHash = computeExportSettingsHash({
		videoPath: VIDEO_PATH,
		settings: settings(),
	});
	return {
		exportId: "morec-static-layout-test-1",
		settingsHash,
		videoPath: VIDEO_PATH,
		savedAt: 1_700_000_000_000,
		...overrides,
	};
}

describe("computeExportSettingsHash", () => {
	it("is stable for identical settings", () => {
		const first = computeExportSettingsHash({ videoPath: VIDEO_PATH, settings: settings() });
		const second = computeExportSettingsHash({ videoPath: VIDEO_PATH, settings: settings() });
		expect(first).toBe(second);
	});

	it("changes when rendering-relevant settings change", () => {
		const baseline = computeExportSettingsHash({ videoPath: VIDEO_PATH, settings: settings() });
		const variants = [
			settings({ quality: "source" }),
			settings({ encodingMode: "quality" }),
			settings({ mp4FrameRate: 60 }),
			settings({ targetSizeMb: 25 }),
			settings({ canvas: "9:16" as const }),
		];

		for (const variant of variants) {
			expect(
				computeExportSettingsHash({ videoPath: VIDEO_PATH, settings: variant }),
			).not.toBe(baseline);
		}
	});

	it("changes when the video path changes", () => {
		const baseline = computeExportSettingsHash({ videoPath: VIDEO_PATH, settings: settings() });
		expect(
			computeExportSettingsHash({
				videoPath: "/videos/other.mp4",
				settings: settings(),
			}),
		).not.toBe(baseline);
	});
});

describe("pending resumable export storage", () => {
	let store: Map<string, string>;

	beforeEach(() => {
		store = new Map();
		(globalThis as { localStorage?: unknown }).localStorage = {
			getItem: (key: string) => store.get(key) ?? null,
			setItem: (key: string, value: string) => {
				store.set(key, value);
			},
			removeItem: (key: string) => {
				store.delete(key);
			},
		};
	});

	afterEach(() => {
		delete (globalThis as { localStorage?: unknown }).localStorage;
	});

	it("round-trips and clears the pending entry", () => {
		const entry = pending();
		savePendingResumableExport(entry);
		expect(loadPendingResumableExport()).toEqual(entry);

		clearPendingResumableExport();
		expect(loadPendingResumableExport()).toBeNull();
	});

	it("ignores malformed stored entries", () => {
		store.set("morec.export.resumableSession", JSON.stringify({ exportId: 42 }));
		expect(loadPendingResumableExport()).toBeNull();
	});
});

describe("resolveResumableExportBanner", () => {
	const sessionStatus = { found: true, segmentCount: 10, doneCount: 6 };

	it("shows the banner when video, settings hash, pipeline, and session all match", () => {
		expect(
			resolveResumableExportBanner({
				pending: pending(),
				videoPath: VIDEO_PATH,
				settings: settings(),
				exportPipelineModel: "modern",
				sessionStatus,
			}),
		).toEqual({
			exportId: "morec-static-layout-test-1",
			doneCount: 6,
			segmentCount: 10,
		});
	});

	it("hides the banner on a settings hash mismatch", () => {
		expect(
			resolveResumableExportBanner({
				pending: pending(),
				videoPath: VIDEO_PATH,
				settings: settings({ quality: "source" }),
				exportPipelineModel: "modern",
				sessionStatus,
			}),
		).toBeNull();
	});

	it("hides the banner on a video path mismatch", () => {
		expect(
			resolveResumableExportBanner({
				pending: pending({ videoPath: "/videos/other.mp4" }),
				videoPath: VIDEO_PATH,
				settings: settings(),
				exportPipelineModel: "modern",
				sessionStatus,
			}),
		).toBeNull();
	});

	it("hides the banner for the legacy (WebCodecs) pipeline — non-resumable", () => {
		expect(
			resolveResumableExportBanner({
				pending: pending(),
				videoPath: VIDEO_PATH,
				settings: settings(),
				exportPipelineModel: "legacy",
				sessionStatus,
			}),
		).toBeNull();
	});

	it("hides the banner when the session dir no longer exists", () => {
		expect(
			resolveResumableExportBanner({
				pending: pending(),
				videoPath: VIDEO_PATH,
				settings: settings(),
				exportPipelineModel: "modern",
				sessionStatus: { found: false },
			}),
		).toBeNull();
	});

	it("hides the banner when every segment is already done or none are", () => {
		const complete = resolveResumableExportBanner({
			pending: pending(),
			videoPath: VIDEO_PATH,
			settings: settings(),
			exportPipelineModel: "modern",
			sessionStatus: { found: true, segmentCount: 10, doneCount: 10 },
		});
		const untouched = resolveResumableExportBanner({
			pending: pending(),
			videoPath: VIDEO_PATH,
			settings: settings(),
			exportPipelineModel: "modern",
			sessionStatus: { found: true, segmentCount: 10, doneCount: 0 },
		});

		expect(complete).toBeNull();
		expect(untouched).toBeNull();
	});
});
