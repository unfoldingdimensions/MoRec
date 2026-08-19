import { beforeEach, describe, expect, it, vi } from "vitest";

import {
	createBrowserRecordingOptions,
	createProcessedMicrophoneConstraints,
	normalizeBrowserMicrophoneProfile,
	resolveBrowserCaptureCursorPolicy,
	shouldUseNativeWindowsCaptureForSource,
} from "./useScreenRecorder";

type RecordingState = "inactive" | "recording" | "paused";

function createMockMediaRecorder(initialState: RecordingState = "inactive") {
	let _state: RecordingState = initialState;
	return {
		get state() {
			return _state;
		},
		pause: vi.fn(() => {
			if (_state === "recording") _state = "paused";
		}),
		resume: vi.fn(() => {
			if (_state === "paused") _state = "recording";
		}),
		requestData: vi.fn(),
		stop: vi.fn(() => {
			_state = "inactive";
		}),
		start: vi.fn(() => {
			_state = "recording";
		}),
	};
}

describe("createProcessedMicrophoneConstraints", () => {
	it("requests browser voice processing with AGC for the default microphone", () => {
		expect(createProcessedMicrophoneConstraints()).toEqual({
			audio: {
				echoCancellation: true,
				noiseSuppression: true,
				autoGainControl: true,
				channelCount: { ideal: 1 },
				sampleRate: { ideal: 48000 },
			},
			video: false,
		});
	});

	it("keeps default voice processing when a specific microphone is selected", () => {
		expect(createProcessedMicrophoneConstraints("device-123")).toMatchObject({
			audio: {
				deviceId: { exact: "device-123" },
				echoCancellation: true,
				noiseSuppression: true,
				autoGainControl: true,
				channelCount: { ideal: 1 },
				sampleRate: { ideal: 48000 },
			},
			video: false,
		});
	});

	it("can request the legacy browser processed profile for lab comparisons", () => {
		expect(createProcessedMicrophoneConstraints(undefined, "processed")).toMatchObject({
			audio: {
				echoCancellation: true,
				noiseSuppression: true,
				autoGainControl: true,
			},
			video: false,
		});
	});

	it("can disable AGC for lab comparisons", () => {
		expect(createProcessedMicrophoneConstraints(undefined, "no-agc")).toMatchObject({
			audio: {
				echoCancellation: true,
				noiseSuppression: true,
				autoGainControl: false,
			},
			video: false,
		});
	});

	it("can disable echo cancellation for lab comparisons", () => {
		expect(createProcessedMicrophoneConstraints(undefined, "no-echo")).toMatchObject({
			audio: {
				echoCancellation: false,
				noiseSuppression: true,
				autoGainControl: true,
			},
			video: false,
		});
	});

	it("can request a raw browser microphone stream for lab comparisons", () => {
		expect(createProcessedMicrophoneConstraints(undefined, "raw")).toMatchObject({
			audio: {
				echoCancellation: false,
				noiseSuppression: false,
				autoGainControl: false,
			},
			video: false,
		});
	});

	it("normalizes invalid lab microphone profiles to production voice processing", () => {
		expect(normalizeBrowserMicrophoneProfile("RAW")).toBe("raw");
		expect(normalizeBrowserMicrophoneProfile("unknown")).toBe("processed");
		expect(normalizeBrowserMicrophoneProfile(null)).toBe("processed");
	});
});

describe("createBrowserRecordingOptions", () => {
	it("sets an aggregate bitrate target for browser screen recordings", () => {
		expect(
			createBrowserRecordingOptions({
				audioBitsPerSecond: 128_000,
				mimeType: "video/webm;codecs=vp9",
				videoBitsPerSecond: 30_600_000,
			}),
		).toEqual({
			audioBitsPerSecond: 128_000,
			bitsPerSecond: 30_728_000,
			mimeType: "video/webm;codecs=vp9",
			videoBitsPerSecond: 30_600_000,
		});
	});

	it("keeps video-only recordings on the requested video budget", () => {
		expect(
			createBrowserRecordingOptions({
				videoBitsPerSecond: 30_600_000,
			}),
		).toEqual({
			bitsPerSecond: 30_600_000,
			videoBitsPerSecond: 30_600_000,
		});
	});
});

describe("resolveBrowserCaptureCursorPolicy", () => {
	it("preserves the existing hidden-cursor browser policy by default", () => {
		expect(resolveBrowserCaptureCursorPolicy()).toEqual({
			streamCursor: "never",
			hideOsCursorBeforeRecording: true,
			hideEditorOverlayCursorByDefault: true,
		});
	});

	it("uses the browser captured cursor after native Windows capture fails to start", () => {
		expect(
			resolveBrowserCaptureCursorPolicy({ nativeWindowsCaptureStartFailed: true }),
		).toEqual({
			streamCursor: "always",
			hideOsCursorBeforeRecording: false,
			hideEditorOverlayCursorByDefault: true,
		});
	});
});

describe("shouldUseNativeWindowsCaptureForSource", () => {
	it("keeps native Windows capture on screen sources", () => {
		expect(shouldUseNativeWindowsCaptureForSource({ id: "screen:101:0" })).toBe(true);
	});

	it("keeps native Windows capture on window sources", () => {
		expect(shouldUseNativeWindowsCaptureForSource({ id: "window:123456:0" })).toBe(true);
	});

	it("keeps browser capture for non-desktop sources", () => {
		expect(shouldUseNativeWindowsCaptureForSource({ id: "browser-tab:abc" })).toBe(false);
	});
});

function stopRecording(
	recorder: ReturnType<typeof createMockMediaRecorder>,
	isNativeRecording: boolean,
	webcamRecorder?: ReturnType<typeof createMockMediaRecorder> | null,
) {
	if (isNativeRecording) {
		if (webcamRecorder && webcamRecorder.state !== "inactive") {
			webcamRecorder.stop();
		}
		return { stopped: true, wasNative: true };
	}

	const recorderState = recorder.state;
	if (recorderState === "recording" || recorderState === "paused") {
		if (recorderState === "paused") {
			try {
				recorder.resume();
			} catch {
				// Stopping a paused recorder is still valid; mirror the hook's fallback path.
			}
		}
		if (webcamRecorder && webcamRecorder.state !== "inactive") {
			webcamRecorder.stop();
		}
		try {
			recorder.requestData();
		} catch {
			// Stopping should continue even if the browser refuses an explicit flush.
		}
		recorder.stop();
		return { stopped: true, wasNative: false };
	}
	return { stopped: false, wasNative: false };
}

function pauseRecording(
	recorder: ReturnType<typeof createMockMediaRecorder>,
	recording: boolean,
	paused: boolean,
	isNativeRecording: boolean,
	webcamRecorder?: ReturnType<typeof createMockMediaRecorder> | null,
	micFallbackRecorder?: ReturnType<typeof createMockMediaRecorder> | null,
): boolean {
	if (!recording || paused) return false;
	if (isNativeRecording) {
		if (webcamRecorder?.state === "recording") {
			webcamRecorder.pause();
		}
		if (micFallbackRecorder?.state === "recording") {
			micFallbackRecorder.requestData();
			micFallbackRecorder.pause();
		}
		return true;
	}
	if (recorder.state === "recording") {
		recorder.pause();
		if (webcamRecorder?.state === "recording") {
			webcamRecorder.pause();
		}
		return true;
	}
	return false;
}

function resumeRecording(
	recorder: ReturnType<typeof createMockMediaRecorder>,
	recording: boolean,
	paused: boolean,
	isNativeRecording: boolean,
	webcamRecorder?: ReturnType<typeof createMockMediaRecorder> | null,
	micFallbackRecorder?: ReturnType<typeof createMockMediaRecorder> | null,
): boolean {
	if (!recording || !paused) return false;
	if (isNativeRecording) {
		if (webcamRecorder?.state === "paused") {
			webcamRecorder.resume();
		}
		if (micFallbackRecorder?.state === "paused") {
			micFallbackRecorder.resume();
		}
		return true;
	}
	if (recorder.state === "paused") {
		recorder.resume();
		if (webcamRecorder?.state === "paused") {
			webcamRecorder.resume();
		}
		return true;
	}
	return false;
}

async function pauseNativeRecording(
	webcamRecorder?: ReturnType<typeof createMockMediaRecorder> | null,
	result: { success: boolean } = { success: true },
	micFallbackRecorder?: ReturnType<typeof createMockMediaRecorder> | null,
): Promise<boolean> {
	if (!result.success) {
		return false;
	}

	if (webcamRecorder?.state === "recording") {
		webcamRecorder.pause();
	}
	if (micFallbackRecorder?.state === "recording") {
		micFallbackRecorder.requestData();
		micFallbackRecorder.pause();
	}

	return true;
}

async function resumeNativeRecording(
	webcamRecorder?: ReturnType<typeof createMockMediaRecorder> | null,
	result: { success: boolean } = { success: true },
	micFallbackRecorder?: ReturnType<typeof createMockMediaRecorder> | null,
): Promise<boolean> {
	if (!result.success) {
		return false;
	}

	if (webcamRecorder?.state === "paused") {
		webcamRecorder.resume();
	}
	if (micFallbackRecorder?.state === "paused") {
		micFallbackRecorder.resume();
	}

	return true;
}

async function stopNativeRecordingWithCompanions({
	getRecordingDurationMs,
	markRecordingResumed,
	now,
	stopMicFallbackRecorder,
	stopNativeScreenRecording,
	stopWebcamRecorder,
}: {
	getRecordingDurationMs: (timestampMs: number) => number;
	markRecordingResumed: (timestampMs: number) => void;
	now: () => number;
	stopMicFallbackRecorder: () => Promise<Blob | null>;
	stopNativeScreenRecording: () => Promise<{ success: boolean; path?: string }>;
	stopWebcamRecorder: () => Promise<string | null>;
}) {
	const stoppedAtMs = now();
	markRecordingResumed(stoppedAtMs);
	const expectedDurationMs = getRecordingDurationMs(stoppedAtMs);
	const micFallbackBlobPromise = stopMicFallbackRecorder();
	const webcamPathPromise = stopWebcamRecorder();
	const result = await stopNativeScreenRecording();
	const webcamPath = await webcamPathPromise;
	const micFallbackBlob = await micFallbackBlobPromise;

	return { expectedDurationMs, micFallbackBlob, result, webcamPath };
}

async function finalizeNativeRecordingWithCompanions({
	getRecordingDurationMs,
	markRecordingResumed,
	now,
	stopMicFallbackRecorder,
	stopNativeScreenRecording,
	stopWebcamRecorder,
	storeMicrophoneSidecar,
	muxNativeWindowsRecording,
	isNativeWindows = false,
	fallbackStartDelayMs = null,
	fallbackTrackSettings = null,
	finalizeRecordingSession,
	hudOverlayClose,
	onFailure,
}: {
	getRecordingDurationMs: (timestampMs: number) => number;
	markRecordingResumed: (timestampMs: number) => void;
	now: () => number;
	stopMicFallbackRecorder: () => Promise<Blob | null>;
	stopNativeScreenRecording: () => Promise<{ success: boolean; path?: string; error?: string }>;
	stopWebcamRecorder: () => Promise<string | null>;
	storeMicrophoneSidecar?: (
		blobPromise: Promise<Blob | null>,
		videoPath: string,
		startDelayMs?: number | null,
		trackSettings?: MediaTrackSettings | null,
	) => Promise<void>;
	muxNativeWindowsRecording?: (durationMs: number) => Promise<{ success: boolean }>;
	isNativeWindows?: boolean;
	fallbackStartDelayMs?: number | null;
	fallbackTrackSettings?: MediaTrackSettings | null;
	finalizeRecordingSession: (videoPath: string, webcamPath: string | null) => Promise<void>;
	hudOverlayClose?: () => void;
	onFailure?: (msg: string) => Promise<void>;
}) {
	const stoppedAtMs = now();
	markRecordingResumed(stoppedAtMs);
	const expectedDurationMs = getRecordingDurationMs(stoppedAtMs);
	const micFallbackBlobPromise = stopMicFallbackRecorder();
	const webcamPathPromise = stopWebcamRecorder();

	const result = await stopNativeScreenRecording();
	if (!result.success || !result.path) {
		await onFailure?.("Failed to stop native screen recording");
		return { success: false, error: result.error };
	}

	const finalPath = result.path;
	try {
		const webcamPath = await webcamPathPromise;
		if (storeMicrophoneSidecar) {
			await storeMicrophoneSidecar(
				micFallbackBlobPromise,
				finalPath,
				fallbackStartDelayMs,
				fallbackTrackSettings,
			);
		}
		if (isNativeWindows && muxNativeWindowsRecording) {
			await muxNativeWindowsRecording(expectedDurationMs);
		}
		await finalizeRecordingSession(finalPath, webcamPath);
		return { success: true, finalPath, webcamPath, expectedDurationMs };
	} catch (error) {
		await onFailure?.(error instanceof Error ? error.message : String(error));
		throw error;
	} finally {
		hudOverlayClose?.();
	}
}

async function finalizeBrowserRecordingWithWebcam({
	videoResult,
	pendingWebcamPathPromise,
	resolvedWebcamPath,
	finalizeRecordingSession,
	hudOverlayClose,
	onFailure,
}: {
	videoResult: { success: boolean; path?: string; message?: string };
	pendingWebcamPathPromise: Promise<string | null> | null;
	resolvedWebcamPath: string | null;
	finalizeRecordingSession: (videoPath: string, webcamPath: string | null) => Promise<void>;
	hudOverlayClose?: () => void;
	onFailure?: (msg: string) => Promise<void>;
}) {
	if (!videoResult.success || !videoResult.path) {
		await onFailure?.(videoResult.message || "Failed to store video");
		return { success: false };
	}

	const finalVideoPath = videoResult.path;
	try {
		const webcamPath = pendingWebcamPathPromise
			? await pendingWebcamPathPromise
			: resolvedWebcamPath;
		await finalizeRecordingSession(finalVideoPath, webcamPath);
		return { success: true, finalVideoPath, webcamPath };
	} catch (error) {
		await onFailure?.(error instanceof Error ? error.message : String(error));
		throw error;
	} finally {
		hudOverlayClose?.();
	}
}

async function handleRecordingInterrupted({
	state,
	stopMicFallbackRecorder,
	stopWebcamRecorder,
	recoverNativeRecordingSession,
	cleanupCapturedMedia,
	setRecording,
	setPaused,
	setFinalizing,
	isNativeWindows = false,
	expectedDurationMs = 0,
	fallbackStartDelayMs = null,
	fallbackTrackSettings = null,
}: {
	state: { reason: string; message: string };
	stopMicFallbackRecorder: () => Promise<Blob | null>;
	stopWebcamRecorder: () => Promise<string | null>;
	recoverNativeRecordingSession: (
		micFallbackBlobPromise?: Promise<Blob | null> | null,
		startDelayMs?: number | null,
		webcamPathPromise?: Promise<string | null> | null,
		mediaTrackSettings?: any,
		isNativeWindows?: boolean,
		expectedDurationMs?: number,
	) => Promise<string | null>;
	cleanupCapturedMedia: () => void;
	setRecording?: (val: boolean) => void;
	setPaused?: (val: boolean) => void;
	setFinalizing?: (val: boolean) => void;
	isNativeWindows?: boolean;
	expectedDurationMs?: number;
	fallbackStartDelayMs?: number | null;
	fallbackTrackSettings?: any;
}) {
	setRecording?.(false);
	setPaused?.(false);

	if (state.reason !== "window-unavailable") {
		setFinalizing?.(true);
		const micFallbackBlobPromise = stopMicFallbackRecorder();
		const webcamPathPromise = stopWebcamRecorder();
		try {
			const recoveredPath = await recoverNativeRecordingSession(
				micFallbackBlobPromise,
				fallbackStartDelayMs,
				webcamPathPromise,
				fallbackTrackSettings,
				isNativeWindows,
				expectedDurationMs,
			);
			if (recoveredPath) {
				return { recovered: true, path: recoveredPath };
			}
		} finally {
			setFinalizing?.(false);
			cleanupCapturedMedia();
		}
	} else {
		cleanupCapturedMedia();
		await stopWebcamRecorder();
	}

	return { recovered: false, path: null };
}

type MockMediaTrack = {
	stop: ReturnType<typeof vi.fn>;
	readyState: "live" | "ended";
};

type MockMediaStream = {
	getTracks: () => MockMediaTrack[];
};

function createMockMediaTrack(): MockMediaTrack {
	const track: MockMediaTrack = {
		stop: vi.fn(() => {
			track.readyState = "ended";
		}),
		readyState: "live",
	};
	return track;
}

function createMockMediaStream(trackCount = 1): MockMediaStream {
	const tracks = Array.from({ length: trackCount }, () => createMockMediaTrack());
	return {
		getTracks: () => tracks,
	};
}

function createMockFallbackRecorder(initialState: RecordingState = "inactive") {
	const mockRecorder = createMockMediaRecorder(initialState);
	const mockStream = createMockMediaStream(1);
	return Object.assign(mockRecorder, {
		stream: mockStream,
		mimeType: "audio/webm;codecs=opus",
		ondataavailable: null as unknown,
		onstop: null as unknown,
		onerror: null as unknown,
	});
}

function cancelRecording(
	recorder: ReturnType<typeof createMockMediaRecorder> | null | undefined,
	isNativeRecording: boolean,
	chunks: { current: Blob[] },
	webcamRecorder?: ReturnType<typeof createMockMediaRecorder> | null,
	webcamChunks?: { current: Blob[] },
	options?: {
		micFallbackRecorder?: ReturnType<typeof createMockFallbackRecorder> | null;
		micFallbackChunks?: { current: Blob[] };
		microphoneStream?: MockMediaStream | null;
		screenStream?: MockMediaStream | null;
		stream?: MockMediaStream | null;
		webcamStream?: MockMediaStream | null;
		mixingContext?: { close: ReturnType<typeof vi.fn> } | null;
		onCleanupCapturedMedia?: () => void;
	},
) {
	if (webcamChunks) webcamChunks.current = [];
	if (webcamRecorder && webcamRecorder.state !== "inactive") {
		try {
			webcamRecorder.stop();
		} catch {
			/* ignore */
		}
	}
	options?.webcamStream?.getTracks().forEach((t) => t.stop());

	// Unconditionally clean up all captured media (fallback mic, audio contexts, streams)
	options?.onCleanupCapturedMedia?.();

	if (options?.stream) {
		options.stream.getTracks().forEach((t) => t.stop());
	}
	if (options?.screenStream) {
		options.screenStream.getTracks().forEach((t) => t.stop());
	}
	if (options?.microphoneStream) {
		options.microphoneStream.getTracks().forEach((t) => t.stop());
	}
	if (options?.mixingContext) {
		options.mixingContext.close();
	}
	if (options?.micFallbackRecorder) {
		options.micFallbackRecorder.ondataavailable = null;
		options.micFallbackRecorder.onstop = null;
		options.micFallbackRecorder.onerror = null;
		if (options.micFallbackRecorder.state !== "inactive") {
			try {
				options.micFallbackRecorder.stop();
			} catch {
				/* ignore */
			}
		}
		options.micFallbackRecorder.stream.getTracks().forEach((t) => t.stop());
	}
	if (options?.micFallbackChunks) {
		options.micFallbackChunks.current = [];
	}

	if (isNativeRecording) {
		return { cancelled: true, wasNative: true };
	}

	chunks.current = [];
	if (recorder && recorder.state !== "inactive") {
		try {
			recorder.stop();
		} catch {
			/* ignore */
		}
	}
	return { cancelled: true, wasNative: false };
}

describe("useScreenRecorder state machine", () => {
	let recorder: ReturnType<typeof createMockMediaRecorder>;

	beforeEach(() => {
		recorder = createMockMediaRecorder("recording");
	});

	describe("stopRecording", () => {
		it("stops from recording state", () => {
			const result = stopRecording(recorder, false);

			expect(result.stopped).toBe(true);
			expect(recorder.stop).toHaveBeenCalled();
			expect(recorder.resume).not.toHaveBeenCalled();
			expect(recorder.state).toBe("inactive");
		});

		it("resumes then stops from paused state", () => {
			recorder.pause();
			expect(recorder.state).toBe("paused");

			const result = stopRecording(recorder, false);

			expect(result.stopped).toBe(true);
			expect(recorder.resume).toHaveBeenCalled();
			expect(recorder.stop).toHaveBeenCalled();
			expect(recorder.state).toBe("inactive");
		});

		it("resume is called before stop when paused", () => {
			recorder.pause();
			const callOrder: string[] = [];
			recorder.resume.mockImplementation(() => {
				callOrder.push("resume");
			});
			recorder.stop.mockImplementation(() => {
				callOrder.push("stop");
			});

			stopRecording(recorder, false);

			expect(callOrder).toEqual(["resume", "stop"]);
		});

		it("flushes the current recorder data before stopping", () => {
			const callOrder: string[] = [];
			recorder.requestData.mockImplementation(() => {
				callOrder.push("requestData");
			});
			recorder.stop.mockImplementation(() => {
				callOrder.push("stop");
			});

			stopRecording(recorder, false);

			expect(callOrder).toEqual(["requestData", "stop"]);
		});

		it("resumes, flushes, then stops from paused state", () => {
			recorder.pause();
			const callOrder: string[] = [];
			recorder.resume.mockImplementation(() => {
				callOrder.push("resume");
			});
			recorder.requestData.mockImplementation(() => {
				callOrder.push("requestData");
			});
			recorder.stop.mockImplementation(() => {
				callOrder.push("stop");
			});

			stopRecording(recorder, false);

			expect(callOrder).toEqual(["resume", "requestData", "stop"]);
		});

		it("still stops when the explicit data flush fails", () => {
			recorder.requestData.mockImplementation(() => {
				throw new Error("flush failed");
			});

			const result = stopRecording(recorder, false);

			expect(result.stopped).toBe(true);
			expect(recorder.stop).toHaveBeenCalled();
		});

		it("still stops from paused state when the explicit data flush fails", () => {
			recorder.pause();
			const callOrder: string[] = [];
			recorder.resume.mockImplementation(() => {
				callOrder.push("resume");
			});
			recorder.requestData.mockImplementation(() => {
				callOrder.push("requestData");
				throw new Error("flush failed");
			});
			recorder.stop.mockImplementation(() => {
				callOrder.push("stop");
			});

			const result = stopRecording(recorder, false);

			expect(result.stopped).toBe(true);
			expect(callOrder).toEqual(["resume", "requestData", "stop"]);
		});

		it("still stops when resume throws from paused state", () => {
			recorder.pause();
			recorder.resume.mockImplementation(() => {
				throw new Error("resume failed");
			});

			const result = stopRecording(recorder, false);

			expect(result.stopped).toBe(true);
			expect(recorder.stop).toHaveBeenCalled();
			expect(recorder.state).toBe("inactive");
		});

		it("does nothing when already inactive", () => {
			const inactiveRecorder = createMockMediaRecorder("inactive");

			const result = stopRecording(inactiveRecorder, false);

			expect(result.stopped).toBe(false);
			expect(inactiveRecorder.stop).not.toHaveBeenCalled();
		});

		it("delegates to native path for native recordings", () => {
			const result = stopRecording(recorder, true);

			expect(result.stopped).toBe(true);
			expect(result.wasNative).toBe(true);
			expect(recorder.stop).not.toHaveBeenCalled();
		});

		it("stops webcam when stopping browser recording", () => {
			const webcam = createMockMediaRecorder("recording");

			stopRecording(recorder, false, webcam);

			expect(webcam.stop).toHaveBeenCalled();
			expect(webcam.state).toBe("inactive");
		});

		it("stops webcam when stopping native recording", () => {
			const webcam = createMockMediaRecorder("recording");

			stopRecording(recorder, true, webcam);

			expect(webcam.stop).toHaveBeenCalled();
			expect(webcam.state).toBe("inactive");
		});
	});

	describe("pauseRecording", () => {
		it("pauses an active recording", () => {
			const result = pauseRecording(recorder, true, false, false);

			expect(result).toBe(true);
			expect(recorder.pause).toHaveBeenCalled();
			expect(recorder.state).toBe("paused");
		});

		it("does nothing when already paused", () => {
			recorder.pause();
			recorder.pause.mockClear();

			const result = pauseRecording(recorder, true, true, false);

			expect(result).toBe(false);
			expect(recorder.pause).not.toHaveBeenCalled();
		});

		it("does nothing when not recording", () => {
			const result = pauseRecording(recorder, false, false, false);

			expect(result).toBe(false);
			expect(recorder.pause).not.toHaveBeenCalled();
		});

		it("allows pause for native recordings", () => {
			const result = pauseRecording(recorder, true, false, true);

			expect(result).toBe(true);
		});

		it("pauses webcam alongside browser recording", () => {
			const webcam = createMockMediaRecorder("recording");

			pauseRecording(recorder, true, false, false, webcam);

			expect(recorder.state).toBe("paused");
			expect(webcam.state).toBe("paused");
		});

		it("pauses webcam during native recording pause", () => {
			const webcam = createMockMediaRecorder("recording");

			const result = pauseRecording(recorder, true, false, true, webcam);

			expect(result).toBe(true);
			expect(webcam.state).toBe("paused");
		});

		it("pauses browser mic fallback during native recording pause", () => {
			const micFallback = createMockMediaRecorder("recording");

			const result = pauseRecording(recorder, true, false, true, null, micFallback);

			expect(result).toBe(true);
			expect(micFallback.requestData).toHaveBeenCalled();
			expect(micFallback.state).toBe("paused");
		});

		it("skips webcam pause when webcam is not recording", () => {
			const webcam = createMockMediaRecorder("inactive");

			pauseRecording(recorder, true, false, false, webcam);

			expect(webcam.pause).not.toHaveBeenCalled();
		});
	});

	describe("resumeRecording", () => {
		it("resumes a paused recording", () => {
			recorder.pause();

			const result = resumeRecording(recorder, true, true, false);

			expect(result).toBe(true);
			expect(recorder.resume).toHaveBeenCalled();
			expect(recorder.state).toBe("recording");
		});

		it("does nothing when not paused", () => {
			const result = resumeRecording(recorder, true, false, false);

			expect(result).toBe(false);
			expect(recorder.resume).not.toHaveBeenCalled();
		});

		it("does nothing when not recording", () => {
			const result = resumeRecording(recorder, false, true, false);

			expect(result).toBe(false);
		});

		it("resumes webcam alongside browser recording", () => {
			const webcam = createMockMediaRecorder("recording");
			recorder.pause();
			webcam.pause();

			resumeRecording(recorder, true, true, false, webcam);

			expect(recorder.state).toBe("recording");
			expect(webcam.state).toBe("recording");
		});

		it("resumes webcam during native recording resume", () => {
			const webcam = createMockMediaRecorder("recording");
			webcam.pause();

			const result = resumeRecording(recorder, true, true, true, webcam);

			expect(result).toBe(true);
			expect(webcam.state).toBe("recording");
		});

		it("resumes browser mic fallback during native recording resume", () => {
			const micFallback = createMockMediaRecorder("recording");
			micFallback.pause();

			const result = resumeRecording(recorder, true, true, true, null, micFallback);

			expect(result).toBe(true);
			expect(micFallback.state).toBe("recording");
		});

		it("skips webcam resume when webcam is not paused", () => {
			recorder.pause();
			const webcam = createMockMediaRecorder("inactive");

			resumeRecording(recorder, true, true, false, webcam);

			expect(webcam.resume).not.toHaveBeenCalled();
		});
	});

	describe("cancelRecording", () => {
		it("clears chunks and stops browser recording", () => {
			const chunks = { current: [new Blob(["data"])] };

			const result = cancelRecording(recorder, false, chunks);

			expect(result.cancelled).toBe(true);
			expect(result.wasNative).toBe(false);
			expect(chunks.current).toEqual([]);
			expect(recorder.stop).toHaveBeenCalled();
			expect(recorder.state).toBe("inactive");
		});

		it("clears webcam chunks and stops webcam on cancel", () => {
			const chunks = { current: [new Blob(["data"])] };
			const webcamChunks = { current: [new Blob(["cam"])] };
			const webcam = createMockMediaRecorder("recording");

			cancelRecording(recorder, false, chunks, webcam, webcamChunks);

			expect(webcamChunks.current).toEqual([]);
			expect(webcam.stop).toHaveBeenCalled();
			expect(webcam.state).toBe("inactive");
		});

		it("stops webcam when cancelling native recording", () => {
			const chunks = { current: [] as Blob[] };
			const webcam = createMockMediaRecorder("recording");

			const result = cancelRecording(recorder, true, chunks, webcam);

			expect(result.wasNative).toBe(true);
			expect(webcam.stop).toHaveBeenCalled();
			expect(recorder.stop).not.toHaveBeenCalled();
		});

		it("handles cancel when recorder is already inactive", () => {
			const inactiveRecorder = createMockMediaRecorder("inactive");
			const chunks = { current: [new Blob(["data"])] };

			const result = cancelRecording(inactiveRecorder, false, chunks);

			expect(result.cancelled).toBe(true);
			expect(chunks.current).toEqual([]);
			expect(inactiveRecorder.stop).not.toHaveBeenCalled();
		});

		it("handles cancel when webcam is already inactive", () => {
			const chunks = { current: [] as Blob[] };
			const webcam = createMockMediaRecorder("inactive");

			cancelRecording(recorder, false, chunks, webcam);

			expect(webcam.stop).not.toHaveBeenCalled();
		});

		it("cancels native recording with fallback microphone, stopping fallback recorder, detaching listeners, stopping tracks, and clearing chunks", () => {
			const chunks = { current: [] as Blob[] };
			const micFallbackChunks = { current: [new Blob(["mic-audio"])] };
			const micFallback = createMockFallbackRecorder("recording");
			micFallback.ondataavailable = vi.fn();
			micFallback.onstop = vi.fn();
			micFallback.onerror = vi.fn();
			const micFallbackTrack = micFallback.stream.getTracks()[0];

			const result = cancelRecording(recorder, true, chunks, null, undefined, {
				micFallbackRecorder: micFallback,
				micFallbackChunks,
			});

			expect(result.wasNative).toBe(true);
			expect(result.cancelled).toBe(true);
			expect(micFallback.stop).toHaveBeenCalled();
			expect(micFallback.state).toBe("inactive");
			expect(micFallback.ondataavailable).toBeNull();
			expect(micFallback.onstop).toBeNull();
			expect(micFallback.onerror).toBeNull();
			expect(micFallbackTrack.stop).toHaveBeenCalled();
			expect(micFallbackTrack.readyState).toBe("ended");
			expect(micFallbackChunks.current).toEqual([]);
		});

		it("cancels native recording with fallback mic and webcam simultaneously", () => {
			const chunks = { current: [] as Blob[] };
			const webcamChunks = { current: [new Blob(["cam"])] };
			const micFallbackChunks = { current: [new Blob(["mic"])] };
			const webcam = createMockMediaRecorder("recording");
			const webcamStream = createMockMediaStream(1);
			const micFallback = createMockFallbackRecorder("recording");

			const result = cancelRecording(recorder, true, chunks, webcam, webcamChunks, {
				webcamStream,
				micFallbackRecorder: micFallback,
				micFallbackChunks,
			});

			expect(result.wasNative).toBe(true);
			expect(webcamChunks.current).toEqual([]);
			expect(micFallbackChunks.current).toEqual([]);
			expect(webcam.stop).toHaveBeenCalled();
			expect(webcamStream.getTracks()[0].stop).toHaveBeenCalled();
			expect(micFallback.stop).toHaveBeenCalled();
			expect(micFallback.stream.getTracks()[0].stop).toHaveBeenCalled();
		});

		it("cancels standard browser recording with microphone stream and AudioContext mixing", () => {
			const chunks = { current: [new Blob(["video"])] };
			const micStream = createMockMediaStream(1);
			const screenStream = createMockMediaStream(1);
			const mixedStream = createMockMediaStream(2);
			const mixingContext = { close: vi.fn().mockResolvedValue(undefined) };

			const result = cancelRecording(recorder, false, chunks, null, undefined, {
				stream: mixedStream,
				screenStream,
				microphoneStream: micStream,
				mixingContext,
			});

			expect(result.wasNative).toBe(false);
			expect(chunks.current).toEqual([]);
			expect(recorder.stop).toHaveBeenCalled();
			expect(micStream.getTracks()[0].stop).toHaveBeenCalled();
			expect(screenStream.getTracks()[0].stop).toHaveBeenCalled();
			expect(mixedStream.getTracks()[0].stop).toHaveBeenCalled();
			expect(mixedStream.getTracks()[1].stop).toHaveBeenCalled();
			expect(mixingContext.close).toHaveBeenCalled();
		});

		it("handles cancel when fallback mic recorder is already inactive", () => {
			const chunks = { current: [] as Blob[] };
			const micFallbackChunks = { current: [new Blob(["mic"])] };
			const micFallback = createMockFallbackRecorder("inactive");
			const track = micFallback.stream.getTracks()[0];

			cancelRecording(recorder, true, chunks, null, undefined, {
				micFallbackRecorder: micFallback,
				micFallbackChunks,
			});

			expect(micFallback.stop).not.toHaveBeenCalled();
			expect(track.stop).toHaveBeenCalled();
			expect(micFallbackChunks.current).toEqual([]);
		});

		it("handles exceptions thrown during recorder stop gracefully during cancellation", () => {
			const chunks = { current: [] as Blob[] };
			const webcam = createMockMediaRecorder("recording");
			webcam.stop.mockImplementation(() => {
				throw new Error("Webcam stop failed");
			});
			const micFallback = createMockFallbackRecorder("recording");
			micFallback.stop.mockImplementation(() => {
				throw new Error("Mic stop failed");
			});

			expect(() => {
				cancelRecording(recorder, true, chunks, webcam, undefined, {
					micFallbackRecorder: micFallback,
				});
			}).not.toThrow();

			expect(micFallback.stream.getTracks()[0].stop).toHaveBeenCalled();
		});
	});

	describe("pause → stop → editor flow", () => {
		it("record → pause → stop completes cleanly", () => {
			expect(recorder.state).toBe("recording");

			pauseRecording(recorder, true, false, false);
			expect(recorder.state).toBe("paused");

			const result = stopRecording(recorder, false);
			expect(result.stopped).toBe(true);
			expect(recorder.state).toBe("inactive");
		});

		it("record → pause → resume → stop completes cleanly", () => {
			expect(recorder.state).toBe("recording");

			pauseRecording(recorder, true, false, false);
			expect(recorder.state).toBe("paused");

			resumeRecording(recorder, true, true, false);
			expect(recorder.state).toBe("recording");

			const result = stopRecording(recorder, false);
			expect(result.stopped).toBe(true);
			expect(recorder.state).toBe("inactive");
		});

		it("webcam stays in sync through full pause/resume/stop cycle", () => {
			const webcam = createMockMediaRecorder("recording");

			pauseRecording(recorder, true, false, false, webcam);
			expect(recorder.state).toBe("paused");
			expect(webcam.state).toBe("paused");

			resumeRecording(recorder, true, true, false, webcam);
			expect(recorder.state).toBe("recording");
			expect(webcam.state).toBe("recording");

			stopRecording(recorder, false, webcam);
			expect(recorder.state).toBe("inactive");
			expect(webcam.state).toBe("inactive");
		});

		it("native recording pauses webcam only after native pause succeeds", async () => {
			const webcam = createMockMediaRecorder("recording");
			const micFallback = createMockMediaRecorder("recording");

			const pausedResult = await pauseNativeRecording(webcam, { success: true }, micFallback);
			expect(pausedResult).toBe(true);
			expect(webcam.state).toBe("paused");
			expect(micFallback.requestData).toHaveBeenCalled();
			expect(micFallback.state).toBe("paused");
			expect(recorder.pause).not.toHaveBeenCalled();

			const resumedResult = await resumeNativeRecording(
				webcam,
				{ success: true },
				micFallback,
			);
			expect(resumedResult).toBe(true);
			expect(webcam.state).toBe("recording");
			expect(micFallback.state).toBe("recording");
			expect(recorder.resume).not.toHaveBeenCalled();
		});

		it("native recording leaves webcam state alone when native pause fails", async () => {
			const webcam = createMockMediaRecorder("recording");
			const micFallback = createMockMediaRecorder("recording");

			const pausedResult = await pauseNativeRecording(
				webcam,
				{ success: false },
				micFallback,
			);

			expect(pausedResult).toBe(false);
			expect(webcam.state).toBe("recording");
			expect(webcam.pause).not.toHaveBeenCalled();
			expect(micFallback.state).toBe("recording");
			expect(micFallback.pause).not.toHaveBeenCalled();
		});

		it("stops native capture before awaiting webcam finalization", async () => {
			const callOrder: string[] = [];
			let resolveWebcam: (path: string | null) => void = () => {};
			const webcamPathPromise = new Promise<string | null>((resolve) => {
				resolveWebcam = resolve;
			});
			const stopWebcamRecorder = vi.fn(() => {
				callOrder.push("stop-webcam-started");
				return webcamPathPromise;
			});
			const stopNativeScreenRecording = vi.fn(async () => {
				callOrder.push("stop-native");
				return { success: true, path: "screen.mp4" };
			});
			const markRecordingResumed = vi.fn((timestampMs: number) => {
				callOrder.push(`mark-resumed-${timestampMs}`);
			});
			const getRecordingDurationMs = vi.fn((timestampMs: number) => {
				callOrder.push(`duration-${timestampMs}`);
				return 35000;
			});

			let finalized = false;
			const stopped = stopNativeRecordingWithCompanions({
				getRecordingDurationMs,
				markRecordingResumed,
				now: () => 123456,
				stopMicFallbackRecorder: vi.fn(async () => null),
				stopNativeScreenRecording,
				stopWebcamRecorder,
			}).then((result) => {
				finalized = true;
				return result;
			});

			await Promise.resolve();
			expect(callOrder).toEqual([
				"mark-resumed-123456",
				"duration-123456",
				"stop-webcam-started",
				"stop-native",
			]);
			expect(finalized).toBe(false);

			resolveWebcam("webcam.webm");
			await expect(stopped).resolves.toMatchObject({
				expectedDurationMs: 35000,
				webcamPath: "webcam.webm",
			});
		});

		it("cancel discards both screen and webcam recordings", () => {
			const webcam = createMockMediaRecorder("recording");
			const chunks = { current: [new Blob(["screen"])] };
			const webcamChunks = { current: [new Blob(["cam"])] };

			cancelRecording(recorder, false, chunks, webcam, webcamChunks);

			expect(chunks.current).toEqual([]);
			expect(webcamChunks.current).toEqual([]);
			expect(recorder.state).toBe("inactive");
			expect(webcam.state).toBe("inactive");
		});
	});

	describe("safe recording finalization and companion synchronization (R3)", () => {
		it("awaits webcam and mic fallback sidecar before calling finalizeRecordingSession and closing HUD", async () => {
			const callOrder: string[] = [];
			let resolveWebcam: (path: string | null) => void = () => {};
			const webcamPathPromise = new Promise<string | null>((resolve) => {
				resolveWebcam = resolve;
			});

			let resolveSidecar: () => void = () => {};
			const sidecarPromise = new Promise<void>((resolve) => {
				resolveSidecar = resolve;
			});

			const stopWebcamRecorder = vi.fn(() => {
				callOrder.push("stop-webcam-started");
				return webcamPathPromise;
			});

			const stopMicFallbackRecorder = vi.fn(async () => {
				callOrder.push("stop-mic-fallback-started");
				return new Blob(["mic-audio"], { type: "audio/webm" });
			});

			const stopNativeScreenRecording = vi.fn(async () => {
				callOrder.push("stop-native-started");
				return { success: true, path: "/recordings/recording-123.mp4" };
			});

			const storeMicrophoneSidecar = vi.fn(async () => {
				callOrder.push("store-mic-sidecar-started");
				await sidecarPromise;
				callOrder.push("store-mic-sidecar-completed");
			});

			const finalizeRecordingSession = vi.fn(async (videoPath: string, webcamPath: string | null) => {
				callOrder.push(`finalize-session:${videoPath}:${webcamPath}`);
			});

			const hudOverlayClose = vi.fn(() => {
				callOrder.push("hud-overlay-close");
			});

			let finalized = false;
			const finalizationPromise = finalizeNativeRecordingWithCompanions({
				getRecordingDurationMs: () => 15000,
				markRecordingResumed: vi.fn(),
				now: () => 1000,
				stopMicFallbackRecorder,
				stopNativeScreenRecording,
				stopWebcamRecorder,
				storeMicrophoneSidecar,
				finalizeRecordingSession,
				hudOverlayClose,
			}).then((res) => {
				finalized = true;
				return res;
			});

			await Promise.resolve();
			expect(callOrder).toEqual([
				"stop-mic-fallback-started",
				"stop-webcam-started",
				"stop-native-started",
			]);
			expect(finalized).toBe(false);

			// Resolve webcam path
			resolveWebcam("/recordings/recording-123-webcam.webm");
			await Promise.resolve();
			await Promise.resolve();

			expect(callOrder).toContain("store-mic-sidecar-started");
			expect(finalized).toBe(false);

			// Resolve mic sidecar ffmpeg transcoding
			resolveSidecar();
			const result = await finalizationPromise;

			expect(result).toMatchObject({
				success: true,
				finalPath: "/recordings/recording-123.mp4",
				webcamPath: "/recordings/recording-123-webcam.webm",
			});

			expect(callOrder).toEqual([
				"stop-mic-fallback-started",
				"stop-webcam-started",
				"stop-native-started",
				"store-mic-sidecar-started",
				"store-mic-sidecar-completed",
				"finalize-session:/recordings/recording-123.mp4:/recordings/recording-123-webcam.webm",
				"hud-overlay-close",
			]);
			expect(finalizeRecordingSession).toHaveBeenCalledWith(
				"/recordings/recording-123.mp4",
				"/recordings/recording-123-webcam.webm",
			);
		});

		it("awaits Windows companion audio muxing before finalizeRecordingSession when isNativeWindows is true", async () => {
			const callOrder: string[] = [];

			const stopNativeScreenRecording = vi.fn(async () => {
				callOrder.push("stop-native");
				return { success: true, path: "/recordings/recording-win.mp4" };
			});

			const muxNativeWindowsRecording = vi.fn(async (durationMs: number) => {
				callOrder.push(`mux-windows-audio:${durationMs}`);
				return { success: true };
			});

			const finalizeRecordingSession = vi.fn(async (videoPath: string, webcamPath: string | null) => {
				callOrder.push(`finalize-session:${videoPath}:${webcamPath}`);
			});

			const hudOverlayClose = vi.fn(() => {
				callOrder.push("hud-overlay-close");
			});

			await finalizeNativeRecordingWithCompanions({
				getRecordingDurationMs: () => 42000,
				markRecordingResumed: vi.fn(),
				now: () => 2000,
				stopMicFallbackRecorder: vi.fn(async () => null),
				stopNativeScreenRecording,
				stopWebcamRecorder: vi.fn(async () => "/recordings/recording-win-webcam.mp4"),
				muxNativeWindowsRecording,
				isNativeWindows: true,
				finalizeRecordingSession,
				hudOverlayClose,
			});

			expect(callOrder).toEqual([
				"stop-native",
				"mux-windows-audio:42000",
				"finalize-session:/recordings/recording-win.mp4:/recordings/recording-win-webcam.mp4",
				"hud-overlay-close",
			]);
			expect(muxNativeWindowsRecording).toHaveBeenCalledWith(42000);
		});

		it("passes null webcamPath when webcam was inactive without breaking atomic session persistence", async () => {
			const finalizeRecordingSession = vi.fn(async () => {});
			const hudOverlayClose = vi.fn();

			await finalizeNativeRecordingWithCompanions({
				getRecordingDurationMs: () => 10000,
				markRecordingResumed: vi.fn(),
				now: () => 3000,
				stopMicFallbackRecorder: vi.fn(async () => null),
				stopNativeScreenRecording: vi.fn(async () => ({ success: true, path: "screen.mp4" })),
				stopWebcamRecorder: vi.fn(async () => null),
				finalizeRecordingSession,
				hudOverlayClose,
			});

			expect(finalizeRecordingSession).toHaveBeenCalledWith("screen.mp4", null);
			expect(hudOverlayClose).toHaveBeenCalledTimes(1);
		});

		it("executes hudOverlayClose in finally block even if finalizeRecordingSession throws", async () => {
			const hudOverlayClose = vi.fn();
			const onFailure = vi.fn(async () => {});

			await expect(
				finalizeNativeRecordingWithCompanions({
					getRecordingDurationMs: () => 5000,
					markRecordingResumed: vi.fn(),
					now: () => 4000,
					stopMicFallbackRecorder: vi.fn(async () => null),
					stopNativeScreenRecording: vi.fn(async () => ({ success: true, path: "screen.mp4" })),
					stopWebcamRecorder: vi.fn(async () => "webcam.webm"),
					finalizeRecordingSession: vi.fn(async () => {
						throw new Error("Failed to switch to editor");
					}),
					hudOverlayClose,
					onFailure,
				}),
			).rejects.toThrow("Failed to switch to editor");

			expect(onFailure).toHaveBeenCalledWith("Failed to switch to editor");
			expect(hudOverlayClose).toHaveBeenCalledTimes(1);
		});

		it("browser capture awaits pending webcam path promise and passes webcamPath to finalizeRecordingSession before hudOverlayClose", async () => {
			const callOrder: string[] = [];
			let resolveWebcam: (path: string | null) => void = () => {};
			const pendingWebcamPathPromise = new Promise<string | null>((resolve) => {
				resolveWebcam = resolve;
			});

			const finalizeRecordingSession = vi.fn(async (videoPath: string, webcamPath: string | null) => {
				callOrder.push(`finalize-browser:${videoPath}:${webcamPath}`);
			});

			const hudOverlayClose = vi.fn(() => {
				callOrder.push("hud-overlay-close");
			});

			let finalized = false;
			const browserPromise = finalizeBrowserRecordingWithWebcam({
				videoResult: { success: true, path: "/recordings/browser-screen.webm" },
				pendingWebcamPathPromise,
				resolvedWebcamPath: null,
				finalizeRecordingSession,
				hudOverlayClose,
			}).then((res) => {
				finalized = true;
				return res;
			});

			await Promise.resolve();
			expect(finalized).toBe(false);

			resolveWebcam("/recordings/browser-webcam.webm");
			const result = await browserPromise;

			expect(result).toMatchObject({
				success: true,
				finalVideoPath: "/recordings/browser-screen.webm",
				webcamPath: "/recordings/browser-webcam.webm",
			});
			expect(callOrder).toEqual([
				"finalize-browser:/recordings/browser-screen.webm:/recordings/browser-webcam.webm",
				"hud-overlay-close",
			]);
		});

		it("browser capture closes HUD overlay even on failure", async () => {
			const hudOverlayClose = vi.fn();
			const onFailure = vi.fn(async () => {});

			await expect(
				finalizeBrowserRecordingWithWebcam({
					videoResult: { success: true, path: "/recordings/browser.webm" },
					pendingWebcamPathPromise: null,
					resolvedWebcamPath: null,
					finalizeRecordingSession: vi.fn(async () => {
						throw new Error("Disk full");
					}),
					hudOverlayClose,
					onFailure,
				}),
			).rejects.toThrow("Disk full");

			expect(hudOverlayClose).toHaveBeenCalledTimes(1);
			expect(onFailure).toHaveBeenCalledWith("Disk full");
		});

		it("handles concurrent stop without race conditions when both webcam and fallback mic are active", async () => {
			const micFallback = createMockFallbackRecorder("recording");
			const webcam = createMockMediaRecorder("recording");
			const screenRecorder = createMockMediaRecorder("recording");

			// Start both
			expect(micFallback.state).toBe("recording");
			expect(webcam.state).toBe("recording");
			expect(screenRecorder.state).toBe("recording");

			// Pause all (native mode)
			pauseRecording(screenRecorder, true, false, true, webcam, micFallback);
			expect(webcam.state).toBe("paused");
			expect(micFallback.state).toBe("paused");

			// Resume all (native mode)
			resumeRecording(screenRecorder, true, true, true, webcam, micFallback);
			expect(webcam.state).toBe("recording");
			expect(micFallback.state).toBe("recording");

			// Stop both
			stopRecording(screenRecorder, false, webcam);
			expect(screenRecorder.state).toBe("inactive");
			expect(webcam.state).toBe("inactive");
		});

		describe("recording interruption handling and companion recovery", () => {
			it("preserves fallback mic audio chunks and webcam stream during recovery from interruption", async () => {
				const callOrder: string[] = [];
				const micChunks = [new Blob(["mic-audio"], { type: "audio/webm" })];
				const micFallback = createMockFallbackRecorder("recording");

				const stopMicFallbackRecorder = vi.fn(async () => {
					callOrder.push("stop-mic-fallback");
					micFallback.stop();
					return new Blob(micChunks, { type: "audio/webm" });
				});

				const stopWebcamRecorder = vi.fn(async () => {
					callOrder.push("stop-webcam");
					return "/recordings/recovered-webcam.mp4";
				});

				const cleanupCapturedMedia = vi.fn(() => {
					callOrder.push("cleanup-captured-media");
				});

				const setFinalizing = vi.fn((val: boolean) => {
					callOrder.push(`set-finalizing:${val}`);
				});

				const recoverNativeRecordingSession = vi.fn(
					async (
						micPromise?: Promise<Blob | null> | null,
						_startDelay?: number | null,
						webcamPromise?: Promise<string | null> | null,
					) => {
						callOrder.push("recover-native-session");
						const micBlob = await micPromise;
						const webcamPath = await webcamPromise;
						expect(micBlob).not.toBeNull();
						expect(webcamPath).toBe("/recordings/recovered-webcam.mp4");
						return "/recordings/recovered-screen.mp4";
					},
				);

				const result = await handleRecordingInterrupted({
					state: { reason: "display-disconnected", message: "Display disconnected" },
					stopMicFallbackRecorder,
					stopWebcamRecorder,
					recoverNativeRecordingSession,
					cleanupCapturedMedia,
					setFinalizing,
					fallbackStartDelayMs: 150,
					fallbackTrackSettings: { deviceId: "mic-1" } as any,
				});

				expect(result).toEqual({
					recovered: true,
					path: "/recordings/recovered-screen.mp4",
				});
				expect(callOrder).toEqual([
					"set-finalizing:true",
					"stop-mic-fallback",
					"stop-webcam",
					"recover-native-session",
					"set-finalizing:false",
					"cleanup-captured-media",
				]);
			});

			it("awaits Windows companion audio muxing before finalizeRecordingSession when isNativeWindows is true during interruption recovery", async () => {
				const callOrder: string[] = [];

				const stopMicFallbackRecorder = vi.fn(async () => {
					callOrder.push("stop-mic-fallback");
					return null;
				});

				const stopWebcamRecorder = vi.fn(async () => {
					callOrder.push("stop-webcam");
					return "/recordings/recovered-win-webcam.mp4";
				});

				const cleanupCapturedMedia = vi.fn(() => {
					callOrder.push("cleanup-captured-media");
				});

				const setFinalizing = vi.fn((val: boolean) => {
					callOrder.push(`set-finalizing:${val}`);
				});

				const muxNativeWindowsRecording = vi.fn(async (durationMs?: number) => {
					callOrder.push(`mux-windows-audio:${durationMs}`);
					return { success: true };
				});

				const finalizeRecordingSession = vi.fn(async (videoPath: string, webcamPath: string | null) => {
					callOrder.push(`finalize-session:${videoPath}:${webcamPath}`);
				});

				const recoverNativeRecordingSession = vi.fn(
					async (
						_micPromise?: Promise<Blob | null> | null,
						_startDelay?: number | null,
						webcamPromise?: Promise<string | null> | null,
						_trackSettings?: any,
						isNativeWindows?: boolean,
						expectedDurationMs?: number,
					) => {
						callOrder.push("recover-native-session");
						const webcamPath = await webcamPromise;
						if (isNativeWindows) {
							await muxNativeWindowsRecording(expectedDurationMs);
						}
						await finalizeRecordingSession("/recordings/recovered-win.mp4", webcamPath);
						return "/recordings/recovered-win.mp4";
					},
				);

				const result = await handleRecordingInterrupted({
					state: { reason: "target-process-exited", message: "Process exited" },
					stopMicFallbackRecorder,
					stopWebcamRecorder,
					recoverNativeRecordingSession,
					cleanupCapturedMedia,
					setFinalizing,
					isNativeWindows: true,
					expectedDurationMs: 35000,
				});

				expect(result).toEqual({
					recovered: true,
					path: "/recordings/recovered-win.mp4",
				});
				expect(callOrder).toEqual([
					"set-finalizing:true",
					"stop-mic-fallback",
					"stop-webcam",
					"recover-native-session",
					"mux-windows-audio:35000",
					"finalize-session:/recordings/recovered-win.mp4:/recordings/recovered-win-webcam.mp4",
					"set-finalizing:false",
					"cleanup-captured-media",
				]);
				expect(muxNativeWindowsRecording).toHaveBeenCalledWith(35000);
			});

			it("cleans up media without calling recoverNativeRecordingSession when reason is window-unavailable", async () => {
				const callOrder: string[] = [];
				const stopMicFallbackRecorder = vi.fn(async () => null);
				const stopWebcamRecorder = vi.fn(async () => {
					callOrder.push("stop-webcam");
					return null;
				});
				const recoverNativeRecordingSession = vi.fn();
				const cleanupCapturedMedia = vi.fn(() => {
					callOrder.push("cleanup-captured-media");
				});

				const result = await handleRecordingInterrupted({
					state: { reason: "window-unavailable", message: "Target window closed" },
					stopMicFallbackRecorder,
					stopWebcamRecorder,
					recoverNativeRecordingSession,
					cleanupCapturedMedia,
				});

				expect(result).toEqual({ recovered: false, path: null });
				expect(recoverNativeRecordingSession).not.toHaveBeenCalled();
				expect(callOrder).toEqual(["cleanup-captured-media", "stop-webcam"]);
			});
		});
	});
});
