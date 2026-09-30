import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
	app: {
		getPath: vi.fn(() => os.tmpdir()),
		isPackaged: false,
	},
}));

import { muxNativeVideoExportAudio } from "./native-video";

const execFileAsync = promisify(execFile);
const nodeRequire = createRequire(import.meta.url);

function ffmpegStaticPath(): string {
	const moduleExports = nodeRequire("ffmpeg-static") as string | { default: string };
	return typeof moduleExports === "string" ? moduleExports : moduleExports.default;
}

interface MuxFixture {
	videoPath: string;
	driftedAudioPath: string;
	alignedAudioPath: string;
}

async function runFfmpeg(args: string[]): Promise<{ stdout: string; stderr: string }> {
	try {
		return await execFileAsync(ffmpegStaticPath(), ["-y", "-hide_banner", ...args], {
			timeout: 60_000,
			maxBuffer: 4 * 1024 * 1024,
		});
	} catch (error) {
		const processError = error as { stdout?: string; stderr?: string; message?: string };
		throw new Error(
			`ffmpeg ${args.join(" ")} failed: ${processError.stderr ?? processError.message}`,
		);
	}
}

async function probeFirstAudioStreamDurationSec(inputPath: string): Promise<number> {
	const { parseRecordingStreamDurations } = await import("./syncProbe");
	const ffprobeStatic = nodeRequire("ffprobe-static") as { path: string };
	const result = await execFileAsync(
		ffprobeStatic.path,
		[
			"-v",
			"error",
			"-select_streams",
			"a:0",
			"-show_entries",
			"stream=codec_type,duration",
			"-of",
			"json",
			inputPath,
		],
		{ timeout: 30_000, maxBuffer: 2 * 1024 * 1024 },
	);
	const parsed = parseRecordingStreamDurations(result.stdout);
	if (parsed.audioDurationSec === null) {
		throw new Error(`No audio duration probed from ${inputPath}: ${result.stdout}`);
	}
	return parsed.audioDurationSec;
}

/** First silence→sound transition time in the muxed output. */
async function detectFirstSoundOnsetSec(inputPath: string): Promise<number> {
	const result = await runFfmpeg([
		"-i",
		inputPath,
		"-af",
		"silencedetect=noise=-40dB:d=0.2",
		"-f",
		"null",
		"-",
	]);
	const matches = [
		...result.stderr.matchAll(/silence_end:\s*([0-9]+(?:\.[0-9]+)?)/g),
	].map((match) => Number(match[1]));
	if (matches.length === 0) {
		throw new Error(`No silence_end detected in ${inputPath}: ${result.stderr}`);
	}
	return matches[0];
}

describe("muxNativeVideoExportAudio drift correction end-to-end", () => {
	let fixture: MuxFixture;
	let outputDir: string;

	beforeAll(async () => {
		outputDir = await fs.mkdtemp(path.join(os.tmpdir(), "morec-mux-drift-"));
		const videoPath = path.join(outputDir, "video.mp4");
		const driftedAudioPath = path.join(outputDir, "drifted.wav");
		const alignedAudioPath = path.join(outputDir, "aligned.wav");

		// 2.0 s of video.
		await runFfmpeg([
			"-f",
			"lavfi",
			"-i",
			"testsrc=duration=2:size=320x240:rate=30",
			"-pix_fmt",
			"yuv420p",
			videoPath,
		]);
		// 2.4 s of audio: 0.5 s silence, then a 1.9 s tone — 20% longer than the
		// video, the shape of an audio clock that drifted slow.
		await runFfmpeg([
			"-f",
			"lavfi",
			"-i",
			"sine=frequency=440:duration=1.9",
			"-af",
			"adelay=500",
			driftedAudioPath,
		]);
		// 2.0 s of audio: 0.5 s silence, then a 1.5 s tone — aligned.
		await runFfmpeg([
			"-f",
			"lavfi",
			"-i",
			"sine=frequency=440:duration=1.5",
			"-af",
			"adelay=500",
			alignedAudioPath,
		]);

		fixture = { videoPath, driftedAudioPath, alignedAudioPath };
	}, 120_000);

	afterAll(async () => {
		await fs.rm(outputDir, { recursive: true, force: true });
	});

	it(
		"lands a tone at the corrected position when the audio ran long",
		{ timeout: 120_000 },
		async () => {
			// muxNativeVideoExportAudio consumes (deletes) the video input, so mux
			// a copy and keep the original for the aligned case.
			const videoCopyPath = path.join(outputDir, "video-drifted.mp4");
			await fs.copyFile(fixture.videoPath, videoCopyPath);

			const result = await muxNativeVideoExportAudio(videoCopyPath, {
				audioMode: "copy-source",
				audioSourcePath: fixture.driftedAudioPath,
				audioSourceCodec: "pcm_s16le",
				outputDurationSec: 2,
			});
			expect(result.metrics.audioDriftTempoFactor).toBeCloseTo(1.2, 6);
			expect(result.metrics.audioDriftSeconds).toBeGreaterThan(0.3);

			// The correction compresses 2.4 s of audio into the 2.0 s video
			// timeline; the tone that started at 0.5 s must land at 0.5/1.2.
			const outputAudioDurationSec = await probeFirstAudioStreamDurationSec(
				result.outputPath,
			);
			expect(outputAudioDurationSec).toBeGreaterThan(1.8);
			expect(outputAudioDurationSec).toBeLessThan(2.2);

			const onsetSec = await detectFirstSoundOnsetSec(result.outputPath);
			expect(onsetSec).toBeGreaterThan(0.33);
			expect(onsetSec).toBeLessThan(0.5);
		},
	);

	it(
		"keeps aligned audio untouched — the tone stays at 0.5 s",
		{ timeout: 120_000 },
		async () => {
			const videoCopyPath = path.join(outputDir, "video-aligned.mp4");
			await fs.copyFile(fixture.videoPath, videoCopyPath);

			const result = await muxNativeVideoExportAudio(videoCopyPath, {
				audioMode: "copy-source",
				audioSourcePath: fixture.alignedAudioPath,
				audioSourceCodec: "pcm_s16le",
				outputDurationSec: 2,
			});
			expect(result.metrics.audioDriftTempoFactor).toBeUndefined();

			const onsetSec = await detectFirstSoundOnsetSec(result.outputPath);
			expect(onsetSec).toBeGreaterThan(0.44);
			expect(onsetSec).toBeLessThan(0.56);
		},
	);
});
