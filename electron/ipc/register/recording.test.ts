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

const recordingWindowsFallbacks = {
	shouldStartWindowsBrowserMicrophoneFallback: vi.fn(() => false),
	shouldUseWindowsBrowserMicrophoneFallback: vi.fn(
		(captureOutput: string) =>
			captureOutput.includes("WARNING: Failed to initialize WASAPI mic capture"),
	),
	WINDOWS_MIC_CAPTURE_INIT_WARNING: "WARNING: Failed to initialize WASAPI mic capture",
};

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
		for (const fn of Object.values(recordingWindowsFallbacks)) {
			if (typeof fn === "function") {
				fn.mockReset();
			}
		}
		recordingWindowsFallbacks.shouldStartWindowsBrowserMicrophoneFallback.mockImplementation(
			() => false,
		);
		recordingWindowsFallbacks.shouldUseWindowsBrowserMicrophoneFallback.mockImplementation(
			(captureOutput: string) =>
				captureOutput.includes("WARNING: Failed to initialize WASAPI mic capture"),
		);
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
		vi.doMock("../recording/windowsFallbacks", () => recordingWindowsFallbacks);
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
		vi.doMock("../project/manager", async (importOriginal) => {
			const actual = await importOriginal<typeof import("../project/manager")>();
			return {
				...actual,
				rememberApprovedLocalReadPath: vi.fn(),
			};
		});
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

	it("switches to browser mic fallback when the WASAPI warning lands after start", async () => {
		recordingWindows.isNativeWindowsCaptureAvailable.mockResolvedValue({ available: true });

		const startPromise = registry.invoke("start-native-screen-recording", SOURCE, {
			capturesSystemAudio: false,
			capturesMicrophone: true,
		});

		// The helper writes the mic-init warning to stderr around the time the
		// start marker lands on stdout; deliver it while the handler's settle
		// window is open.
		await new Promise((resolve) => setTimeout(resolve, 20));
		const proc = spawnMock.mock.results[0]?.value as FakeCaptureProcess;
		proc.stderr.emit("data", Buffer.from("WARNING: Failed to initialize WASAPI mic capture\n"));

		const result = (await startPromise) as {
			success: boolean;
			microphoneFallbackRequired: boolean;
		};
		expect(result).toEqual({ success: true, microphoneFallbackRequired: true });
		// The native mic sidecar path is orphaned so stop/recover cleans it up.
		expect(state.windowsOrphanedMicAudioPath).toBeTruthy();
		expect(state.windowsMicAudioPath).toBeNull();
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
		for (const fn of Object.values(recordingWindowsFallbacks)) {
			if (typeof fn === "function") {
				fn.mockReset();
			}
		}
		recordingWindowsFallbacks.shouldStartWindowsBrowserMicrophoneFallback.mockImplementation(
			() => false,
		);
		recordingWindowsFallbacks.shouldUseWindowsBrowserMicrophoneFallback.mockImplementation(
			(captureOutput: string) =>
				captureOutput.includes("WARNING: Failed to initialize WASAPI mic capture"),
		);

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
		vi.doMock("../recording/windowsFallbacks", () => recordingWindowsFallbacks);
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
		vi.doMock("../project/manager", async (importOriginal) => {
			const actual = await importOriginal<typeof import("../project/manager")>();
			return {
				...actual,
				rememberApprovedLocalReadPath: vi.fn(),
			};
		});
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

	it("rejects microphone sidecar stores outside the recordings directory", async () => {
		await expect(
			registry.invoke(
				"store-microphone-sidecar",
				new ArrayBuffer(8),
				"C:\\elsewhere\\video.mp4",
			),
		).resolves.toMatchObject({ success: false });
	});
});

/**
 * Path-policy gate tests: `store-microphone-sidecar` and the cursor telemetry
 * handlers derive every file location from the renderer-supplied video path,
 * so each handler must pass the real `isAllowedLocalReadPath` gate from
 * `../project/manager` before touching the filesystem. The electron mock
 * points the policy prefixes (userData/temp) inside a throwaway fixture root,
 * leaving an `outside` directory beyond every prefix to act as the unapproved
 * renderer-chosen path.
 */
describe("register/recording renderer path gates", () => {
	let fixtureRoot: string;
	const registry = new IpcRegistry({
		app: {
			getPath: (name: string) => {
				if (name === "temp") return path.join(fixtureRoot, "temp");
				if (name === "userData") return path.join(fixtureRoot, "userData");
				return fixtureRoot;
			},
		},
	});
	let execFileMock: ReturnType<typeof vi.fn>;
	let diagnosticsMock: {
		getCompanionAudioFallbackInfo: ReturnType<typeof vi.fn>;
		getFileSizeIfPresent: ReturnType<typeof vi.fn>;
		recordNativeCaptureDiagnostics: ReturnType<typeof vi.fn>;
		summarizeMicrophoneChunkTiming: ReturnType<typeof vi.fn>;
		validateRecordedVideo: ReturnType<typeof vi.fn>;
		writeRecordingDiagnosticsSnapshot: ReturnType<typeof vi.fn>;
	};

	const makeOutsideVideoPath = async () => {
		const outsideDir = path.join(fixtureRoot, "outside");
		await fs.mkdir(outsideDir, { recursive: true });
		return path.join(outsideDir, "clip.webm");
	};

	beforeEach(async () => {
		fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), "morec-recording-gates-"));
		vi.resetModules();
		registry.reset();
		registry.installElectronMock();

		// The win32 orchestration describes above register file-scoped mocks
		// (vi.doMock) they never unmock; undo the ones that would swap the real
		// policy gate, approval helpers, or telemetry writer these tests assert
		// against.
		vi.doUnmock("../project/manager");
		vi.doUnmock("../utils");
		vi.doUnmock("../cursor/telemetry");
		vi.doUnmock("../recording/audioFilters");

		// promisify(execFile) needs a callback-style mock; mimic ffmpeg by
		// creating the output file (main's atomic sidecar writer renames it
		// into place) before resolving.
		execFileMock = vi.fn((_file, args, _options, callback) => {
			const outputPath = (args as string[]).at(-1);
			void fs
				.writeFile(outputPath ?? "", "fake-ffmpeg-output")
				.finally(() => callback(null, "", ""));
		});
		vi.doMock("node:child_process", () => ({
			spawn: vi.fn(),
			execFile: execFileMock,
		}));
		vi.doMock("../ffmpeg/binary", () => ({
			getFfmpegBinaryPath: vi.fn(() => "/fake/ffmpeg"),
		}));
		diagnosticsMock = {
			getCompanionAudioFallbackInfo: vi.fn(() => null),
			getFileSizeIfPresent: vi.fn(async () => 0),
			recordNativeCaptureDiagnostics: vi.fn(),
			summarizeMicrophoneChunkTiming: vi.fn(() => null),
			validateRecordedVideo: vi.fn(),
			writeRecordingDiagnosticsSnapshot: vi.fn(async () => null),
		};
		vi.doMock("../recording/diagnostics", () => diagnosticsMock);

		const { registerRecordingHandlers } = await import("./recording");
		registerRecordingHandlers();
	});

	afterEach(async () => {
		vi.restoreAllMocks();
		vi.resetModules();
		vi.doUnmock("electron");
		vi.doUnmock("node:child_process");
		vi.doUnmock("../ffmpeg/binary");
		vi.doUnmock("../recording/diagnostics");
		await fs.rm(fixtureRoot, { recursive: true, force: true });
	});

	it("store-microphone-sidecar writes nothing and fails for an unapproved path", async () => {
		const videoPath = await makeOutsideVideoPath();
		await fs.writeFile(videoPath, "video");
		const baseName = videoPath.replace(/\.[^.]+$/, "");
		// Pre-place a derived target so an unguarded write would be visible.
		const sidecarPath = `${baseName}.mic.wav`;
		await fs.writeFile(sidecarPath, "do-not-touch");

		const result = (await registry.invoke(
			"store-microphone-sidecar",
			new ArrayBuffer(8),
			videoPath,
		)) as { success: boolean };

		expect(result.success).toBe(false);
		expect(await fs.readFile(sidecarPath, "utf-8")).toBe("do-not-touch");
		await expect(fs.access(`${baseName}.mic.source.webm.tmp`)).rejects.toMatchObject({
			code: "ENOENT",
		});
		await expect(fs.access(`${baseName}.mic.wav.json`)).rejects.toMatchObject({
			code: "ENOENT",
		});
		await expect(fs.access(`${baseName}.recording-diagnostics.json`)).rejects.toMatchObject({
			code: "ENOENT",
		});
		expect(execFileMock).not.toHaveBeenCalled();
		expect(diagnosticsMock.writeRecordingDiagnosticsSnapshot).not.toHaveBeenCalled();
	});

	it("store-microphone-sidecar proceeds for a recording inside the recordings dir", async () => {
		const recordingsDir = path.join(fixtureRoot, "userData", "recordings");
		await fs.mkdir(recordingsDir, { recursive: true });
		const videoPath = path.join(recordingsDir, "recording-42.webm");
		await fs.writeFile(videoPath, "video");

		const result = (await registry.invoke(
			"store-microphone-sidecar",
			new ArrayBuffer(8),
			videoPath,
		)) as { success: boolean; path?: string };

		expect(result.success).toBe(true);
		const expectedSidecar = `${videoPath.replace(/\.[^.]+$/, "")}.mic.wav`;
		expect(result.path).toBe(expectedSidecar);
		expect(execFileMock).toHaveBeenCalledTimes(1);
		const ffmpegArgs = execFileMock.mock.calls[0][1] as string[];
		// The atomic sidecar writer stages ffmpeg's output beside the final
		// path and renames it into place.
		expect(ffmpegArgs[ffmpegArgs.length - 1]).toBe(`${expectedSidecar}.tmp`);
		await expect(fs.access(expectedSidecar)).resolves.toBeUndefined();
		await expect(
			fs.access(`${videoPath.replace(/\.[^.]+$/, "")}.mic.source.webm.tmp`),
		).rejects.toMatchObject({ code: "ENOENT" });
	});

	it("set-cursor-telemetry fails without writing for an unapproved path", async () => {
		const videoPath = await makeOutsideVideoPath();

		const result = (await registry.invoke("set-cursor-telemetry", videoPath, [
			{ timeMs: 10, cx: 0.25, cy: 0.75 },
		])) as { success: boolean; samples: unknown[] };

		expect(result.success).toBe(false);
		expect(result.samples).toEqual([]);
		// The real writeCursorTelemetry would have created this for non-empty samples.
		await expect(fs.access(`${videoPath}.cursor.json`)).rejects.toMatchObject({
			code: "ENOENT",
		});
	});

	it("get-cursor-telemetry reports no samples for an unapproved path", async () => {
		const videoPath = await makeOutsideVideoPath();
		await fs.writeFile(`${videoPath}.cursor.json`, "secret-telemetry", "utf-8");
		// ENOENT and a rejected read look identical to the renderer, so observe
		// the read itself: an unapproved telemetry file must never be opened.
		const readFileSpy = vi.spyOn(
			await import("node:fs/promises").then((m) => m.default),
			"readFile",
		);

		expect(await registry.invoke("get-cursor-telemetry", videoPath)).toEqual({
			success: true,
			samples: [],
		});
		expect(readFileSpy).not.toHaveBeenCalled();
	});
});
