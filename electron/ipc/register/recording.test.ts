import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IpcRegistry } from "../../test/ipcRegistry";

/**
 * Handler-level tests for the win32 start path of `register/recording.ts`,
 * focusing on the start-serialization contract: a second start while one is
 * in flight is rejected instead of killing the first helper, and an already
 * active recording is rejected.
 */
const recordingWindows = {
	isNativeWindowsCaptureAvailable: vi.fn(),
	waitForWindowsCaptureStart: vi.fn(async () => undefined),
	waitForWindowsCaptureStop: vi.fn(async () => "/tmp/morec-native-1.mp4"),
	attachWindowsCaptureLifecycle: vi.fn(),
	muxNativeWindowsVideoWithAudio: vi.fn(),
};

const recordingDiagnostics = {
	getCompanionAudioFallbackInfo: vi.fn(() => null),
	getFileSizeIfPresent: vi.fn(async () => 0),
	recordNativeCaptureDiagnostics: vi.fn(),
	summarizeMicrophoneChunkTiming: vi.fn(() => null),
	validateRecordedVideo: vi.fn(),
	writeRecordingDiagnosticsSnapshot: vi.fn(),
};

	/** Holds the first start at waitForWindowsCaptureStart (past the mutex). */
	function makeControlledStartGate() {
		let release: (() => void) | null = null;
		recordingWindows.waitForWindowsCaptureStart.mockImplementation(
			() =>
				new Promise<void>((resolve) => {
					release = resolve;
				}),
		);
		return () => release?.();
	}

class FakeCaptureProcess extends EventEmitter {
	stdout = new PassThrough();
	stderr = new PassThrough();
	stdin = new PassThrough();
	killed = false;
	kill = vi.fn(() => {
		this.killed = true;
		return true;
	});
}

const SOURCE = { id: "screen:0", name: "Screen 1", display_id: "0" };

describe("register/recording start orchestration (win32)", () => {
	const registry = new IpcRegistry();
	let spawnMock: ReturnType<typeof vi.fn>;
	// Imported dynamically AFTER the electron mock is installed (vi.doMock is
	// not hoisted, so static imports would bind the real electron).
	let state: typeof import("../state");

	beforeEach(async () => {
		vi.resetModules();
		registry.reset();
		registry.installElectronMock();
		state = await import("../state");

		// These tests exercise the win32 start path; route the platform checks
		// through it on every OS.
		vi.spyOn(process, "platform", "get").mockReturnValue("win32");

		for (const fn of Object.values(recordingWindows)) {
			fn.mockReset();
		}
		for (const fn of Object.values(recordingDiagnostics)) {
			fn.mockReset();
		}
		// The availability check precedes every other branch in the start path.
		recordingWindows.isNativeWindowsCaptureAvailable.mockResolvedValue({ available: true });
		recordingWindows.waitForWindowsCaptureStart.mockResolvedValue(undefined);
		recordingWindows.attachWindowsCaptureLifecycle.mockReturnValue(undefined);

		spawnMock = vi.fn(() => new FakeCaptureProcess());
		vi.doMock("node:child_process", () => ({
			spawn: spawnMock,
			execFile: vi.fn(),
		}));

		vi.doMock("../recording/windows", () => recordingWindows);
		vi.doMock("../recording/mac", () => ({
			attachNativeCaptureLifecycle: vi.fn(),
			finalizeStoredVideo: vi.fn(),
			muxNativeMacRecordingWithAudio: vi.fn(),
			recoverNativeMacCaptureOutput: vi.fn(),
			waitForNativeCaptureStart: vi.fn(),
			waitForNativeCaptureStop: vi.fn(),
		}));
		vi.doMock("../recording/windowsFallbacks", () => ({
			shouldStartWindowsBrowserMicrophoneFallback: vi.fn(() => false),
			shouldUseWindowsBrowserMicrophoneFallback: vi.fn(() => false),
		}));
		vi.doMock("../monitorResolver", () => ({
			getMonitorHandlesAsync: vi.fn(async () => []),
		}));
		vi.doMock("../windowsCaptureSelection", () => ({
			// Synchronous in the real module; the handler uses it without await.
			resolveWindowsCaptureTarget: vi.fn(() => ({
				kind: "display",
				bounds: { x: 0, y: 0, width: 1920, height: 1080 },
				displayId: 1,
			})),
		}));
		vi.doMock("../paths/binaries", () => ({
			ensureNativeCaptureHelperBinary: vi.fn(async () => "/fake/helper"),
			ensureSwiftHelperBinary: vi.fn(async () => "/fake/helper"),
			getNativeCaptureHelperBinaryPath: vi.fn(() => "/fake/helper"),
			getSystemCursorHelperBinaryPath: vi.fn(() => "/fake/cursor"),
			getSystemCursorHelperSourcePath: vi.fn(() => "/fake/cursor.swift"),
			getWindowsCaptureExePath: vi.fn(() => "/fake/wgc-capture.exe"),
		}));
		vi.doMock("../cursor/bounds", () => ({
			startWindowBoundsCapture: vi.fn(),
			stopWindowBoundsCapture: vi.fn(),
		}));
		vi.doMock("../cursor/interaction", () => ({
			startInteractionCapture: vi.fn(),
			stopInteractionCapture: vi.fn(),
		}));
		vi.doMock("../cursor/monitor", () => ({
			startNativeCursorMonitor: vi.fn(),
			stopNativeCursorMonitor: vi.fn(),
		}));
		vi.doMock("../cursor/telemetry", () => ({
			normalizeCursorTelemetrySamples: vi.fn((v: unknown) => v),
			pauseCursorCaptureAtBoundary: vi.fn(),
			persistPendingCursorTelemetry: vi.fn(async () => undefined),
			resetCursorCaptureClock: vi.fn(),
			resumeCursorCapture: vi.fn(),
			sampleCursorPoint: vi.fn(() => null),
			snapshotCursorTelemetryForPersistence: vi.fn(),
			startCursorSampling: vi.fn(),
			stopCursorCapture: vi.fn(),
			writeCursorTelemetry: vi.fn(),
		}));
		vi.doMock("../ffmpeg/binary", () => ({
			getFfmpegBinaryPath: vi.fn(() => "/fake/ffmpeg"),
		}));
		vi.doMock("../recording/diagnostics", () => recordingDiagnostics);
		vi.doMock("../recording/audioFilters", () => ({
			getBrowserMicSidecarFilters: vi.fn(() => []),
			shouldKeepRecordingAudioSidecars: vi.fn(() => false),
		}));
		vi.doMock("../recording/storagePath", () => ({
			resolveRecordedVideoStoragePath: vi.fn(async (p: string) => p),
		}));
		vi.doMock("../project/manager", () => ({
			rememberApprovedLocalReadPath: vi.fn(),
		}));
		// utils.getScreen() uses createRequire("electron"), which bypasses the
		// electron module mock; override it with a plain stub instead.
		vi.doMock("../utils", async (importOriginal) => {
			const actual = await importOriginal<typeof import("../utils")>();
			return {
				...actual,
				getScreen: () => ({
					getAllDisplays: () => [],
					getPrimaryDisplay: () => ({
						id: 1,
						bounds: { x: 0, y: 0, width: 1920, height: 1080 },
					}),
				}),
			};
		});
		vi.doMock("../../cursorHider", () => ({
			hideCursor: vi.fn(() => true),
			showCursor: vi.fn(),
		}));

		const { registerRecordingHandlers } = await import("./recording");
		registerRecordingHandlers();
	});

	afterEach(() => {
		vi.restoreAllMocks();
		vi.resetModules();
		vi.doUnmock("electron");
		vi.doUnmock("node:child_process");
		vi.doUnmock("../recording/windows");
		vi.doUnmock("../recording/mac");
		vi.doUnmock("../recording/windowsFallbacks");
		vi.doUnmock("../monitorResolver");
		vi.doUnmock("../windowsCaptureSelection");
		vi.doUnmock("../paths/binaries");
		vi.doUnmock("../cursor/bounds");
		vi.doUnmock("../cursor/interaction");
		vi.doUnmock("../cursor/monitor");
		vi.doUnmock("../cursor/telemetry");
		vi.doUnmock("../ffmpeg/binary");
		vi.doUnmock("../recording/diagnostics");
		vi.doUnmock("../recording/audioFilters");
		vi.doUnmock("../recording/storagePath");
		vi.doUnmock("../project/manager");
		vi.doUnmock("../utils");
		vi.doUnmock("../../cursorHider");
		state?.setWindowsNativeCaptureActive(false);
		state?.setWindowsCaptureStopRequested(false);
		state?.setWindowsCaptureProcess(null);
	});

	it("rejects a second start while the first is still in flight", async () => {
		const releaseStart = makeControlledStartGate();

		const first = registry.invoke("start-native-screen-recording", SOURCE, {
			capturesSystemAudio: false,
			capturesMicrophone: false,
		});
		// Let the first invocation reach the start gate (past the mutex).
		await new Promise((resolve) => setTimeout(resolve, 20));

		expect(
			await registry.invoke("start-native-screen-recording", SOURCE, {
				capturesSystemAudio: false,
				capturesMicrophone: false,
			}),
		).toEqual({
			success: false,
			message: "A native Windows screen recording is already starting.",
		});

		releaseStart();
		const firstResult = (await first) as { success: boolean };
		expect(firstResult.success).toBe(true);
		expect(spawnMock).toHaveBeenCalledTimes(1);
	});

	it("rejects a start when a recording is already active", async () => {
		const proc = new FakeCaptureProcess();
		state.setWindowsCaptureProcess(proc as never);
		state.setWindowsNativeCaptureActive(true);

		expect(
			await registry.invoke("start-native-screen-recording", SOURCE, {
				capturesSystemAudio: false,
				capturesMicrophone: false,
			}),
		).toEqual({
			success: false,
			message: "A native Windows screen recording is already active.",
		});
		expect(spawnMock).not.toHaveBeenCalled();
	});

	it("starts a recording and reports success", async () => {
		recordingWindows.isNativeWindowsCaptureAvailable.mockResolvedValue({ available: true });

		const result = (await registry.invoke("start-native-screen-recording", SOURCE, {
			capturesSystemAudio: false,
			capturesMicrophone: false,
		})) as { success: boolean; microphoneFallbackRequired: boolean };

		expect(result).toEqual({ success: true, microphoneFallbackRequired: false });
		expect(spawnMock).toHaveBeenCalledTimes(1);
	});
});

describe("register/recording stop recovery (win32)", () => {
	const registry = new IpcRegistry();
	let state: typeof import("../state");

	beforeEach(async () => {
		vi.resetModules();
		registry.reset();
		registry.installElectronMock();
		state = await import("../state");
		vi.spyOn(process, "platform", "get").mockReturnValue("win32");

		for (const fn of Object.values(recordingWindows)) {
			fn.mockReset();
		}
		for (const fn of Object.values(recordingDiagnostics)) {
			fn.mockReset();
		}

		vi.doMock("node:child_process", () => ({
			spawn: vi.fn(() => new FakeCaptureProcess()),
			execFile: vi.fn(),
		}));
		vi.doMock("../recording/windows", () => recordingWindows);
		vi.doMock("../recording/mac", () => ({
			attachNativeCaptureLifecycle: vi.fn(),
			finalizeStoredVideo: vi.fn(),
			muxNativeMacRecordingWithAudio: vi.fn(),
			recoverNativeMacCaptureOutput: vi.fn(),
			waitForNativeCaptureStart: vi.fn(),
			waitForNativeCaptureStop: vi.fn(),
		}));
		vi.doMock("../recording/diagnostics", () => recordingDiagnostics);
		vi.doMock("../recording/windowsFallbacks", () => ({
			shouldStartWindowsBrowserMicrophoneFallback: vi.fn(() => false),
			shouldUseWindowsBrowserMicrophoneFallback: vi.fn(() => false),
		}));
		vi.doMock("../monitorResolver", () => ({
			getMonitorHandlesAsync: vi.fn(async () => []),
		}));
		vi.doMock("../windowsCaptureSelection", () => ({
			resolveWindowsCaptureTarget: vi.fn(() => ({
				kind: "display",
				bounds: { x: 0, y: 0, width: 1920, height: 1080 },
				displayId: 1,
			})),
		}));
		vi.doMock("../paths/binaries", () => ({
			ensureNativeCaptureHelperBinary: vi.fn(async () => "/fake/helper"),
			ensureSwiftHelperBinary: vi.fn(async () => "/fake/helper"),
			getNativeCaptureHelperBinaryPath: vi.fn(() => "/fake/helper"),
			getSystemCursorHelperBinaryPath: vi.fn(() => "/fake/cursor"),
			getSystemCursorHelperSourcePath: vi.fn(() => "/fake/cursor.swift"),
			getWindowsCaptureExePath: vi.fn(() => "/fake/wgc-capture.exe"),
		}));
		vi.doMock("../cursor/bounds", () => ({
			startWindowBoundsCapture: vi.fn(),
			stopWindowBoundsCapture: vi.fn(),
		}));
		vi.doMock("../cursor/interaction", () => ({
			startInteractionCapture: vi.fn(),
			stopInteractionCapture: vi.fn(),
		}));
		vi.doMock("../cursor/monitor", () => ({
			startNativeCursorMonitor: vi.fn(),
			stopNativeCursorMonitor: vi.fn(),
		}));
		vi.doMock("../cursor/telemetry", () => ({
			normalizeCursorTelemetrySamples: vi.fn((v: unknown) => v),
			pauseCursorCaptureAtBoundary: vi.fn(),
			persistPendingCursorTelemetry: vi.fn(async () => undefined),
			resetCursorCaptureClock: vi.fn(),
			resumeCursorCapture: vi.fn(),
			sampleCursorPoint: vi.fn(() => null),
			snapshotCursorTelemetryForPersistence: vi.fn(),
			startCursorSampling: vi.fn(),
			stopCursorCapture: vi.fn(),
			writeCursorTelemetry: vi.fn(),
		}));
		vi.doMock("../ffmpeg/binary", () => ({
			getFfmpegBinaryPath: vi.fn(() => "/fake/ffmpeg"),
		}));
		vi.doMock("../recording/audioFilters", () => ({
			getBrowserMicSidecarFilters: vi.fn(() => []),
			shouldKeepRecordingAudioSidecars: vi.fn(() => false),
		}));
		vi.doMock("../recording/storagePath", () => ({
			resolveRecordedVideoStoragePath: vi.fn(async (p: string) => p),
		}));
		vi.doMock("../project/manager", () => ({
			rememberApprovedLocalReadPath: vi.fn(),
		}));
		vi.doMock("../utils", async (importOriginal) => {
			const actual = await importOriginal<typeof import("../utils")>();
			return {
				...actual,
				getScreen: () => ({
					getAllDisplays: () => [],
					getPrimaryDisplay: () => ({
						id: 1,
						bounds: { x: 0, y: 0, width: 1920, height: 1080 },
					}),
				}),
			};
		});
		vi.doMock("../../cursorHider", () => ({
			hideCursor: vi.fn(() => true),
			showCursor: vi.fn(),
		}));

		const { registerRecordingHandlers } = await import("./recording");
		registerRecordingHandlers();
	});

	afterEach(async () => {
		vi.restoreAllMocks();
		vi.resetModules();
		state?.setWindowsNativeCaptureActive(false);
		state?.setWindowsCaptureStopRequested(false);
		state?.setWindowsCaptureProcess(null);
		state?.setWindowsCaptureTempPath(null);
		state?.setWindowsCaptureTargetPath(null);
		state?.setWindowsSystemAudioPath(null);
		state?.setWindowsMicAudioPath(null);
		state?.setWindowsPendingVideoPath(null);
	});

	it("recovers a stranded temp take when stop is invoked with no active capture", async () => {
		recordingDiagnostics.validateRecordedVideo.mockResolvedValue({
			fileSizeBytes: 4096,
			durationSeconds: 12,
		});
		const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "morec-recover-temp-"));
		const finalRoot = await fs.mkdtemp(path.join(os.tmpdir(), "morec-recover-final-"));
		try {
			const tempVideoPath = path.join(tempRoot, "morec-native-999.mp4");
			const tempMicPath = path.join(tempRoot, "morec-native-999.mic.wav");
			await fs.writeFile(tempVideoPath, "video-bytes");
			await fs.writeFile(tempMicPath, "mic-bytes");
			const finalVideoPath = path.join(finalRoot, "recording-999.mp4");
			const finalMicPath = path.join(finalRoot, "recording-999.mic.wav");
			state.setWindowsCaptureTempPath(tempVideoPath);
			state.setWindowsCaptureTargetPath(finalVideoPath);
			state.setWindowsMicAudioPath(finalMicPath);

			await expect(registry.invoke("stop-native-screen-recording")).resolves.toEqual({
				success: true,
				path: finalVideoPath,
			});
			await expect(fs.readFile(finalVideoPath, "utf8")).resolves.toBe("video-bytes");
			await expect(fs.readFile(finalMicPath, "utf8")).resolves.toBe("mic-bytes");
			await expect(fs.access(tempVideoPath)).rejects.toThrow();
			await expect(fs.access(tempMicPath)).rejects.toThrow();
			// The mux handler picks the recovered take up from the pending path.
			expect(state.windowsPendingVideoPath).toBe(finalVideoPath);
			expect(state.windowsCaptureTempPath).toBeNull();
			expect(state.windowsCaptureTargetPath).toBeNull();
		} finally {
			await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => undefined);
			await fs.rm(finalRoot, { recursive: true, force: true }).catch(() => undefined);
		}
	});

	it("reports a Windows-specific failure and clears state when nothing is recoverable", async () => {
		state.setWindowsCaptureTempPath("C:\\nonexistent\\morec-native-1.mp4");

		await expect(registry.invoke("stop-native-screen-recording")).resolves.toEqual({
			success: false,
			message: "No native Windows screen recording is active.",
		});
		await expect(registry.invoke("recover-native-screen-recording")).resolves.toEqual({
			success: false,
			message: "No recoverable native Windows recording output was found.",
		});
		expect(state.windowsCaptureTempPath).toBeNull();
	});
});
