import { describe, expect, it } from "vitest";
import {
	getVideoExtensionForMimeType,
	isWebmMimeType,
	selectMicrophoneRecordingMimeType,
	selectRecordingMimeType,
	selectWebcamRecordingMimeType,
} from "./recordingMimeType";

describe("selectRecordingMimeType", () => {
	it("keeps browser screen captures in WebM/H.264 when supported", () => {
		const mimeType = selectRecordingMimeType({
			isTypeSupported: () => true,
			canPlayType: (type) => {
				if (type === "video/webm;codecs=h264") {
					return "probably";
				}

				if (type === "video/webm;codecs=vp9") {
					return "maybe";
				}

				return "";
			},
		});

		expect(mimeType).toBe("video/webm;codecs=h264");
	});

	it("skips recorder-only codecs when playback support is missing", () => {
		const mimeType = selectRecordingMimeType({
			isTypeSupported: (type) =>
				["video/webm;codecs=vp9", "video/webm;codecs=vp8"].includes(type),
			canPlayType: (type) => (type === "video/webm;codecs=vp8" ? "probably" : ""),
		});

		expect(mimeType).toBe("video/webm;codecs=vp8");
	});

	it("falls back to the first supported codec when playback probing is unavailable", () => {
		const mimeType = selectRecordingMimeType({
			isTypeSupported: (type) =>
				["video/webm;codecs=av1", "video/webm;codecs=h264"].includes(type),
			canPlayType: () => "",
		});

		expect(mimeType).toBe("video/webm;codecs=h264");
	});

	it("prefers a playable specific codec over the always-playable generic WebM entry", () => {
		const mimeType = selectRecordingMimeType({
			isTypeSupported: () => true,
			canPlayType: (type) =>
				type === "video/webm;codecs=vp8" ? "probably" : type === "video/webm" ? "maybe" : "",
		});

		expect(mimeType).toBe("video/webm;codecs=vp8");
	});

	it("still selects generic WebM when no specific codec is playable", () => {
		const mimeType = selectRecordingMimeType({
			isTypeSupported: () => true,
			canPlayType: (type) => (type === "video/webm" ? "maybe" : ""),
		});

		expect(mimeType).toBe("video/webm");
	});

	it("returns undefined when no preferred mime type is supported", () => {
		const mimeType = selectRecordingMimeType({
			isTypeSupported: () => false,
			canPlayType: () => "",
		});

		expect(mimeType).toBeUndefined();
	});

	it("prefers MP4/H.264 for webcam captures when supported", () => {
		const mimeType = selectWebcamRecordingMimeType({
			isTypeSupported: (type) =>
				["video/mp4;codecs=avc1.42E01E", "video/webm;codecs=vp9"].includes(type),
			canPlayType: () => "probably",
		});

		expect(mimeType).toBe("video/mp4;codecs=avc1.42E01E");
	});

	it("falls back to WebM webcam capture when MP4 is unavailable", () => {
		const mimeType = selectWebcamRecordingMimeType({
			isTypeSupported: (type) => ["video/webm;codecs=vp9", "video/webm"].includes(type),
			canPlayType: () => "probably",
		});

		expect(mimeType).toBe("video/webm;codecs=vp9");
	});

	it("prefers Opus in WebM for the microphone fallback recorder", () => {
		const mimeType = selectMicrophoneRecordingMimeType({
			isTypeSupported: () => true,
			canPlayType: () => "",
		});

		expect(mimeType).toBe("audio/webm;codecs=opus");
	});

	it("degrades the microphone fallback to generic WebM audio when Opus is unsupported", () => {
		const mimeType = selectMicrophoneRecordingMimeType({
			isTypeSupported: (type) => type === "audio/webm",
			canPlayType: () => "",
		});

		expect(mimeType).toBe("audio/webm");
	});

	it("lets the microphone fallback recorder use its default when nothing is supported", () => {
		const mimeType = selectMicrophoneRecordingMimeType({
			isTypeSupported: () => false,
			canPlayType: () => "",
		});

		expect(mimeType).toBeUndefined();
	});

	it("maps recording MIME types to the saved file extension", () => {
		expect(getVideoExtensionForMimeType("video/mp4;codecs=avc1")).toBe(".mp4");
		expect(getVideoExtensionForMimeType("video/webm;codecs=vp9")).toBe(".webm");
		expect(getVideoExtensionForMimeType(undefined)).toBe(".webm");
	});

	it("detects WebM MIME types for duration repair", () => {
		expect(isWebmMimeType("video/webm;codecs=vp9")).toBe(true);
		expect(isWebmMimeType("video/mp4;codecs=avc1")).toBe(false);
		expect(isWebmMimeType(undefined)).toBe(false);
	});
});
