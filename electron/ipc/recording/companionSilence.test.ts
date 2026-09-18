import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { analyzeCompanionAudioSilenceFromVideo } from "./companionSilence";

const { execFileMock, ensureReadableFileMock, candidatesMock } = vi.hoisted(() => ({
	execFileMock: vi.fn(),
	ensureReadableFileMock: vi.fn(async () => undefined),
	candidatesMock: vi.fn(),
}));

vi.mock("electron", () => ({
	app: {
		getPath: (name: string) => (name === "temp" ? os.tmpdir() : os.tmpdir()),
	},
}));

vi.mock("node:child_process", () => ({
	execFile: execFileMock,
	spawn: vi.fn(),
}));

vi.mock("../captions/generate", () => ({
	ensureReadableFile: ensureReadableFileMock,
}));

vi.mock("../ffmpeg/binary", () => ({
	getFfmpegBinaryPath: vi.fn(() => "/fake/ffmpeg"),
}));

vi.mock("../utils", () => ({
	// Mirrors the real normalizer's trim-to-null semantics closely enough for
	// these tests (no file:// inputs here).
	normalizeVideoSourcePath: (value: unknown) =>
		typeof value === "string" && value.trim() ? value.trim() : null,
}));

vi.mock("./diagnostics", () => ({
	getUsableCompanionAudioCandidates: candidatesMock,
}));

const DETECT_STDERR =
	"[silencedetect @ 0x1] silence_start: 1.0\n" +
	"[silencedetect @ 0x1] silence_end: 2.5 | silence_duration: 1.5\n";
const TRAILING_SILENCE_STDERR = "[silencedetect @ 0x1] silence_start: 0.5\n";

/**
 * Fake ffmpeg: detection runs (`-af` in the args) answer with the configured
 * stderr per input; extraction runs (`-map 0:a:0`) create the wav so the
 * ensureReadableFile-style flow sees a real file.
 */
function installFfmpeg(
	detectByInput: Record<string, { stderr?: string; error?: string }>,
) {
	execFileMock.mockImplementation(
		(_file: string, args: string[], _options: unknown, callback: (...cbArgs: unknown[]) => void) => {
			const isDetect = args.includes("-af");
			const inputIndex = args.indexOf("-i");
			const input = args[inputIndex + 1];
			if (!isDetect) {
				const wavPath = args.at(-1) ?? "";
				void fs.writeFile(wavPath, "fake-wav").finally(() => callback(null, "", ""));
				return;
			}
			const outcome = detectByInput[input];
			if (outcome?.error) {
				callback(new Error(outcome.error), "", "");
				return;
			}
			// promisify(execFile) on a plain mock resolves the first success
			// argument, so hand back the { stdout, stderr } shape the real
			// execFile's custom promisify produces.
			callback(null, { stdout: "", stderr: outcome?.stderr ?? "" });
		},
	);
}

describe("analyzeCompanionAudioSilenceFromVideo", () => {
	beforeEach(() => {
		execFileMock.mockReset();
		ensureReadableFileMock.mockReset();
		ensureReadableFileMock.mockResolvedValue(undefined);
		candidatesMock.mockReset();
		candidatesMock.mockResolvedValue([]);
	});

	it("prefers companion sidecars in candidate order and labels the used source", async () => {
		const systemPath = "/rec/take.system.wav";
		const micPath = "/rec/take.mic.wav";
		candidatesMock.mockResolvedValue([
			{ platform: "win", systemPath, micPath, usablePaths: [systemPath, micPath] },
		]);
		installFfmpeg({
			[systemPath]: { error: "exit 1" },
			[micPath]: { stderr: DETECT_STDERR },
		});

		const result = await analyzeCompanionAudioSilenceFromVideo({ videoPath: "/rec/take.mp4" });

		expect(result).toEqual({
			usedSource: "mic",
			intervals: [{ startMs: 1000, endMs: 2500 }],
		});
		const detectInputs = execFileMock.mock.calls.map((call) => (call[1] as string[])[3]);
		expect(detectInputs).toEqual([systemPath, micPath]);
	});

	it("falls back to the video's embedded audio and deletes the temp wav", async () => {
		installFfmpeg({ "/rec/take.system.wav": { error: "exit 1" } });
		let createdWav: string | null = null;
		execFileMock.mockImplementation(
			(_file: string, args: string[], _options: unknown, callback: (...cbArgs: unknown[]) => void) => {
				if (args.includes("-af")) {
					callback(null, { stdout: "", stderr: TRAILING_SILENCE_STDERR });
					return;
				}
				createdWav = args.at(-1) ?? null;
				void fs.writeFile(createdWav ?? "", "fake-wav").finally(() => callback(null, "", ""));
			},
		);

		const result = await analyzeCompanionAudioSilenceFromVideo({ videoPath: "/rec/take.mp4" });

		expect(result.usedSource).toBe("video");
		expect(createdWav).not.toBeNull();
		// A trailing silence with no clamping target cannot be represented over IPC.
		expect(result.intervals).toEqual([]);
		await expect(fs.access(createdWav as string)).rejects.toMatchObject({ code: "ENOENT" });
	});

	it("clamps a trailing silence to the recording duration", async () => {
		installFfmpeg({});
		let detectCalls = 0;
		execFileMock.mockImplementation(
			(_file: string, args: string[], _options: unknown, callback: (...cbArgs: unknown[]) => void) => {
				if (args.includes("-af")) {
					detectCalls += 1;
					callback(null, { stdout: "", stderr: TRAILING_SILENCE_STDERR });
					return;
				}
				void fs.writeFile(args.at(-1) ?? "", "fake-wav").finally(() => callback(null, "", ""));
			},
		);

		const clamped = await analyzeCompanionAudioSilenceFromVideo({
			videoPath: "/rec/take.mp4",
			totalDurationMs: 10_000,
		});
		expect(clamped.intervals).toEqual([{ startMs: 500, endMs: 10_000 }]);

		const extracted = await analyzeCompanionAudioSilenceFromVideo({
			videoPath: "/rec/take.mp4",
		});
		expect(extracted.intervals).toEqual([]);
		expect(detectCalls).toBe(2);
	});

	it("throws the friendly no-audio error when every candidate fails", async () => {
		installFfmpeg({ "/rec/take.system.wav": { error: "exit 1" } });
		// Extraction also fails: the fake ffmpeg never creates the wav, so the
		// real detection run on it errors out.
		execFileMock.mockImplementation(
			(_file: string, args: string[], _options: unknown, callback: (...cbArgs: unknown[]) => void) => {
				if (args.includes("-af")) {
					callback(new Error("no audio stream"), "", "");
					return;
				}
				callback(null, "", "");
			},
		);

		await expect(
			analyzeCompanionAudioSilenceFromVideo({ videoPath: "/rec/take.mp4" }),
		).rejects.toThrow("No audio was found to analyze");
	});

	it("rejects a missing video path before spawning ffmpeg", async () => {
		await expect(
			analyzeCompanionAudioSilenceFromVideo({ videoPath: "   " }),
		).rejects.toThrow("Missing source video path.");
		expect(execFileMock).not.toHaveBeenCalled();
	});
});

describe("silencedetect arg contract", () => {
	it("runs through the existing constants (noise floor + min duration)", async () => {
		const { runSilenceDetect, SILENCE_NOISE_DB, SILENCE_DETECT_MIN_S } = await import(
			"../ffmpeg/silencedetect"
		);
		expect(SILENCE_NOISE_DB).toBe(-30);
		expect(SILENCE_DETECT_MIN_S).toBe(0.5);

		const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "morec-silence-args-"));
		execFileMock.mockImplementation(
			(_file: string, args: string[], _options: unknown, callback: (...cbArgs: unknown[]) => void) => {
				const af = args.find((arg) => arg.startsWith("silencedetect="));
				expect(af).toBe(`silencedetect=noise=${SILENCE_NOISE_DB}dB:d=${SILENCE_DETECT_MIN_S}`);
				expect(args.filter((arg) => arg === "-f").length).toBeGreaterThan(0);
				callback(null, "", "");
			},
		);
		const audioPath = path.join(tempRoot, "probe.wav");
		await runSilenceDetect({ ffmpegPath: "/fake/ffmpeg", audioPath });
	});
});
