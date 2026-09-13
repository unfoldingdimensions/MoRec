import { describe, expect, it } from "vitest";

import {
	createBrowserRecordingOptions,
	createProcessedMicrophoneConstraints,
	normalizeBrowserMicrophoneProfile,
	resolveBrowserCaptureCursorPolicy,
	shouldUseNativeWindowsCaptureForSource,
} from "./useScreenRecorder";

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
