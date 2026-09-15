import { beforeEach, describe, expect, it, vi } from "vitest";

import { resolveCaptionAudioCandidates, shiftCuesByOffset } from "./generate";
import { resolveRecordingSession } from "../project/session";

vi.mock("electron", () => ({
	app: {
		getPath: (name: string) => `C:\\MoRecTest\\${name}`,
	},
	BrowserWindow: {
		getAllWindows: () => [],
	},
}));

vi.mock("../project/session", () => ({
	resolveRecordingSession: vi.fn(async () => null),
}));

const mockedResolveRecordingSession = vi.mocked(resolveRecordingSession);

vi.mock("node:fs/promises", () => ({
	default: {
		stat: vi.fn(async (filePath: string) => {
			if (filePath.endsWith(".system.wav") || filePath.endsWith(".mic.wav")) {
				return { size: 1024, isFile: () => true };
			}
			throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
		}),
	},
}));

describe("resolveCaptionAudioCandidates", () => {
	beforeEach(() => {
		mockedResolveRecordingSession.mockClear();
		mockedResolveRecordingSession.mockResolvedValue(null);
	});

	it("offers existing companion sidecars after the recording and before the webcam", async () => {
		mockedResolveRecordingSession.mockResolvedValue({
			webcamPath: "C:\\Rec\\recording-1-webcam.webm",
		} as never);

		const candidates = await resolveCaptionAudioCandidates("C:\\Rec\\recording-1.mp4");

		expect(candidates[0]).toEqual({ path: "C:\\Rec\\recording-1.mp4", label: "recording" });

		const labels = candidates.map((candidate) => candidate.label);
		expect(labels).toContain("system audio companion track");
		expect(labels).toContain("microphone companion track");
		expect(labels.indexOf("microphone companion track")).toBeGreaterThan(
			labels.indexOf("system audio companion track"),
		);
		// Companion sidecars are timeline-aligned; the offset webcam track is last.
		expect(labels.indexOf("linked webcam recording")).toBe(labels.length - 1);
		expect(candidates.at(-1)?.path).toBe("C:\\Rec\\recording-1-webcam.webm");

		const paths = candidates.map((candidate) => candidate.path);
		expect(paths).toContain("C:\\Rec\\recording-1.system.wav");
		expect(paths).toContain("C:\\Rec\\recording-1.mic.wav");
		// Layouts whose sidecars do not exist on disk are not offered.
		expect(paths).not.toContain("C:\\Rec\\recording-1.system.m4a");
	});

	it("skips the webcam when no linked session exists and dedupes paths", async () => {
		const candidates = await resolveCaptionAudioCandidates("C:\\Rec\\recording-2.mp4");

		const labels = candidates.map((candidate) => candidate.label);
		expect(labels).not.toContain("linked webcam recording");
		expect(new Set(candidates.map((candidate) => candidate.path)).size).toBe(candidates.length);
	});
});

describe("shiftCuesByOffset", () => {
	it("is an identity for zero or non-finite offsets", () => {
		const cues = [{ id: "caption-1", startMs: 100, endMs: 900, text: "Hi" }];
		expect(shiftCuesByOffset(cues, 0)).toBe(cues);
		expect(shiftCuesByOffset(cues, Number.NaN)).toBe(cues);
	});

	it("shifts cues and their word timings onto the timeline", () => {
		const cues = [
			{
				id: "caption-1",
				startMs: 1_000,
				endMs: 2_000,
				text: "Hello world",
				words: [
					{ text: "Hello", startMs: 1_000, endMs: 1_500 },
					{ text: "world", startMs: 1_500, endMs: 2_000, leadingSpace: true },
				],
			},
		];

		const shifted = shiftCuesByOffset(cues, 500);
		expect(shifted[0].startMs).toBe(1_500);
		expect(shifted[0].endMs).toBe(2_500);
		expect(shifted[0].words?.[0].startMs).toBe(1_500);
		expect(shifted[0].words?.[1].endMs).toBe(2_500);
	});

	it("clamps cues pushed before timeline zero instead of emitting negative times", () => {
		const cues = [
			{ id: "caption-1", startMs: -800, endMs: -200, text: "gone" },
			{ id: "caption-2", startMs: -300, endMs: 700, text: "partially before" },
		];

		const shifted = shiftCuesByOffset(cues, -500);
		expect(shifted).toHaveLength(1);
		expect(shifted[0].startMs).toBe(0);
		expect(shifted[0].endMs).toBe(200);
	});
});
