import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IpcRegistry } from "../../test/ipcRegistry";

const probeMocks = vi.hoisted(() => ({
	probeRecordingStreamDurations: vi.fn(),
}));

const managerMocks = vi.hoisted(() => ({
	approvedMediaPaths: new Set<string>(),
}));

/**
 * Handler-level tests for the pre-export integrity self-check. The probe is
 * mocked with fixed fixture durations — a deliberately drifted long recording
 * must be *reported*, never swallowed; aligned and unmeasurable fixtures
 * degrade to their honest statuses.
 */
describe("analyze-recording-sync handler", () => {
	const registry = new IpcRegistry();

	beforeEach(async () => {
		vi.resetModules();
		registry.reset();
		registry.installElectronMock();
		managerMocks.approvedMediaPaths.add("C:\\recordings\\video.mp4");
		managerMocks.approvedMediaPaths.add("C:\\recordings\\video-system.wav");

		vi.doMock("../../appPaths", () => ({
			USER_DATA_PATH: "userData",
			RECORDINGS_DIR: "recordings",
		}));
		vi.doMock("../state", () => ({
			approvedLocalReadPaths: new Set<string>(),
			currentProjectPath: null,
			currentVideoPath: null,
			setCurrentProjectPath: vi.fn(),
			setCurrentVideoPath: vi.fn(),
		}));
		vi.doMock("../project/manager", async (importOriginal) => {
			const actual = await importOriginal<typeof import("../project/manager")>();
			return {
				...actual,
				resolveApprovedLocalMediaPath: async (candidatePath: string) =>
					managerMocks.approvedMediaPaths.has(candidatePath) ? candidatePath : null,
			};
		});
		vi.doMock("../export/syncProbe", async (importOriginal) => {
			const actual = await importOriginal<typeof import("../export/syncProbe")>();
			return {
				...actual,
				probeRecordingStreamDurations: probeMocks.probeRecordingStreamDurations,
			};
		});

		const { registerExportHandlers } = await import("./export");
		registerExportHandlers();
	});

	afterEach(async () => {
		vi.resetModules();
		vi.doUnmock("electron");
		vi.doUnmock("../../appPaths");
		vi.doUnmock("../state");
		vi.doUnmock("../project/manager");
		vi.doUnmock("../export/syncProbe");
		probeMocks.probeRecordingStreamDurations.mockReset();
		managerMocks.approvedMediaPaths.clear();
	});

	it("reports a deliberately drifted 40-minute fixture instead of swallowing it", async () => {
		// 48 s of accumulated audio shortfall — the compaction + clock-drift
		// failure mode this feature exists to catch.
		probeMocks.probeRecordingStreamDurations.mockImplementation(async (inputPath: string) =>
			inputPath.endsWith("video.mp4")
				? { videoDurationSec: 2_400, audioDurationSec: 2_400 }
				: { videoDurationSec: null, audioDurationSec: 2_352 },
		);

		const result = (await registry.invoke(
			"analyze-recording-sync",
			"C:\\recordings\\video.mp4",
			"C:\\recordings\\video-system.wav",
		)) as {
			success: boolean;
			analysis: {
				status: string;
				driftSeconds: number | null;
				maxAbsDriftSeconds: number | null;
				toleranceSeconds: number;
				videoDurationSec: number | null;
				audioDurationSec: number | null;
			};
		};

		expect(result.success).toBe(true);
		expect(result.analysis.status).toBe("drifted");
		expect(result.analysis.driftSeconds).toBeCloseTo(-48, 5);
		expect(result.analysis.maxAbsDriftSeconds).toBeCloseTo(48, 5);
		expect(result.analysis.toleranceSeconds).toBeGreaterThan(0);
		expect(result.analysis.videoDurationSec).toBe(2_400);
		expect(result.analysis.audioDurationSec).toBe(2_352);
	});

	it("keeps a within-tolerance recording aligned", async () => {
		// 0.1 s shortfall sits inside the plausible-start-delay band the shared
		// timing model already tolerates.
		probeMocks.probeRecordingStreamDurations.mockImplementation(async (inputPath: string) =>
			inputPath.endsWith("video.mp4")
				? { videoDurationSec: 2_400, audioDurationSec: 2_400 }
				: { videoDurationSec: null, audioDurationSec: 2_399.9 },
		);

		const result = (await registry.invoke(
			"analyze-recording-sync",
			"C:\\recordings\\video.mp4",
			"C:\\recordings\\video-system.wav",
		)) as { success: boolean; analysis: { status: string; driftSeconds: number | null } };

		expect(result.success).toBe(true);
		expect(result.analysis.status).toBe("aligned");
	});

	it("degrades to unknown — never a fake aligned — when streams are unmeasurable", async () => {
		probeMocks.probeRecordingStreamDurations.mockResolvedValue({
			videoDurationSec: null,
			audioDurationSec: null,
		});

		const result = (await registry.invoke(
			"analyze-recording-sync",
			"C:\\recordings\\video.mp4",
		)) as {
			success: boolean;
			analysis: { status: string; driftSeconds: number | null; videoDurationSec: number | null };
		};

		expect(result.success).toBe(true);
		expect(result.analysis.status).toBe("unknown");
		expect(result.analysis.driftSeconds).toBeNull();
		expect(result.analysis.videoDurationSec).toBeNull();
	});

	it("measures the embedded audio stream when no companion audio is provided", async () => {
		probeMocks.probeRecordingStreamDurations.mockResolvedValue({
			videoDurationSec: 600,
			audioDurationSec: 480,
		});

		const result = (await registry.invoke(
			"analyze-recording-sync",
			"C:\\recordings\\video.mp4",
		)) as { success: boolean; analysis: { status: string; driftSeconds: number | null } };

		expect(result.success).toBe(true);
		expect(result.analysis.status).toBe("drifted");
		expect(result.analysis.driftSeconds).toBeCloseTo(-120, 5);
	});

	it("rejects unapproved paths instead of probing them", async () => {
		const result = (await registry.invoke(
			"analyze-recording-sync",
			"C:\\windows\\system32\\config.sys",
		)) as { success: boolean; error?: string };

		// The installed project/manager mock approves nothing here.
		expect(result.success).toBe(false);
		expect(result.error).toContain("not an approved readable media file");
	});
});
