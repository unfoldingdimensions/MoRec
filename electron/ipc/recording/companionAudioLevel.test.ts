import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	parseVolumedetectOutput,
	probeCompanionAudioLevel,
	PROBE_WINDOW_SECONDS,
} from "./companionAudioLevel";

const { execFileMock } = vi.hoisted(() => ({
	execFileMock: vi.fn(),
}));

vi.mock("node:child_process", () => ({
	execFile: execFileMock,
}));

vi.mock("../utils", () => ({
	// Mirrors the real normalizer's trim-to-null semantics closely enough for
	// these tests (no file:// inputs here).
	normalizeVideoSourcePath: (value: unknown) =>
		typeof value === "string" && value.trim() ? value.trim() : null,
}));

vi.mock("./diagnostics", () => ({
	// Candidate discovery has its own tests; the probe level tests below call
	// probeCompanionAudioLevel directly with concrete paths.
	getUsableCompanionAudioCandidates: vi.fn(async () => []),
}));

const VOLUEMETECT_STDERR =
	"[Parsed_volumedetect_0 @ 0x0] mean_volume: -30.5 dB\n" +
	"[Parsed_volumedetect_0 @ 0x0] max_volume: -12.3 dB\n" +
	"size=N/A time=00:00:01.00 ...";

describe("parseVolumedetectOutput", () => {
	it("parses ffmpeg volumedetect stats", () => {
		expect(parseVolumedetectOutput(VOLUEMETECT_STDERR)).toEqual({
			maxVolumeDb: -12.3,
			meanVolumeDb: -30.5,
		});
	});

	it("returns nulls when no stats are present", () => {
		expect(parseVolumedetectOutput("Output #0, null, to 'pipe:':")).toEqual({
			maxVolumeDb: null,
			meanVolumeDb: null,
		});
	});

	it("parses exact-zero peaks", () => {
		expect(parseVolumedetectOutput("max_volume: 0.0 dB\nmean_volume: -91.2 dB")).toEqual({
			maxVolumeDb: 0,
			meanVolumeDb: -91.2,
		});
	});
});

describe("probeCompanionAudioLevel", () => {
	beforeEach(() => {
		execFileMock.mockReset();
	});

	it("runs a bounded volumedetect probe and reads the peak", async () => {
		execFileMock.mockImplementation(
			(
				_command: string,
				args: string[],
				_options: unknown,
				callback: (error: unknown, stdout: string, stderr: string) => void,
			) => {
				expect(args).toContain("-af");
				expect(args).toContain("volumedetect");
				expect(args.includes("-t") ? args[args.indexOf("-t") + 1] : null).toBe(
					String(PROBE_WINDOW_SECONDS),
				);
				callback(null, "", VOLUEMETECT_STDERR);
			},
		);

		const level = await probeCompanionAudioLevel("ffmpeg", "/r/recording.system.wav");
		expect(level).toEqual({
			path: "/r/recording.system.wav",
			kind: "system",
			maxVolumeDb: -12.3,
			meanVolumeDb: -30.5,
		});
	});

	it("classifies mic sidecars", async () => {
		execFileMock.mockImplementation(
			(
				_command: string,
				_args: string[],
				_options: unknown,
				callback: (error: unknown, stdout: string, stderr: string) => void,
			) => {
				callback(null, "", "max_volume: -5.0 dB\n");
			},
		);

		const level = await probeCompanionAudioLevel("ffmpeg", "/r/recording.mic.wav");
		expect(level.kind).toBe("mic");
		expect(level.maxVolumeDb).toBe(-5);
	});

	it("recovers the stats from a non-zero muxer exit", async () => {
		// Real ffmpeg writes volumedetect stats to stderr even when the null
		// muxer makes it exit non-zero — the probe ignores the exit code.
		execFileMock.mockImplementation(
			(
				_command: string,
				_args: string[],
				_options: unknown,
				callback: (error: unknown, stdout: string, stderr: string) => void,
			) => {
				callback(new Error("Conversion failed!"), "", "max_volume: -3.1 dB\n");
			},
		);

		const level = await probeCompanionAudioLevel("ffmpeg", "/r/recording.system.wav");
		expect(level.maxVolumeDb).toBe(-3.1);
	});

	it("throws when no audio levels could be measured", async () => {
		execFileMock.mockImplementation(
			(
				_command: string,
				_args: string[],
				_options: unknown,
				callback: (error: unknown, stdout: string, stderr: string) => void,
			) => {
				callback(null, "", "Output #0, null:");
			},
		);

		await expect(
			probeCompanionAudioLevel("ffmpeg", "/r/empty.system.wav"),
		).rejects.toThrow(/No audio levels/i);
	});
});
