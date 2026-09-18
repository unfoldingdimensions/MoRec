import { execFile } from "node:child_process";
import { getFfmpegBinaryPath } from "../ffmpeg/binary";
import { normalizeVideoSourcePath } from "../utils";
import { getUsableCompanionAudioCandidates } from "./diagnostics";

/**
 * Peak probe for the post-recording audio diagnostic: answers "was anything
 * actually captured?" for each companion sidecar by running ffmpeg's
 * volumedetect over a short window. Cheap by design — the probe reads at most
 * PROBE_WINDOW_SECONDS of audio and never re-encodes.
 */

export const PROBE_WINDOW_SECONDS = 60;
const PEAK_PROBE_TIMEOUT_MS = 30 * 1000;

export interface CompanionAudioLevel {
	path: string;
	kind: "system" | "mic";
	maxVolumeDb: number | null;
	meanVolumeDb: number | null;
}

export function parseVolumedetectOutput(output: string): {
	maxVolumeDb: number | null;
	meanVolumeDb: number | null;
} {
	const maxMatch = output.match(/max_volume:\s*(-?\d+(?:\.\d+)?)\s*dB/i);
	const meanMatch = output.match(/mean_volume:\s*(-?\d+(?:\.\d+)?)\s*dB/i);
	const parse = (value: string | undefined) =>
		value === undefined ? null : Number.parseFloat(value);
	return {
		maxVolumeDb: parse(maxMatch?.[1]),
		meanVolumeDb: parse(meanMatch?.[1]),
	};
}

function classifyCompanionPath(filePath: string): "system" | "mic" {
	return /\.mic\./i.test(filePath) ? "mic" : "system";
}

/** Runs ffmpeg and always resolves with stderr — volumedetect stats land there
 * even when the null muxer makes ffmpeg exit non-zero. */
function runFfmpegProbe(
	ffmpegPath: string,
	args: string[],
): Promise<{ stderr: string }> {
	return new Promise((resolve) => {
		execFile(
			ffmpegPath,
			args,
			{ timeout: PEAK_PROBE_TIMEOUT_MS, maxBuffer: 10 * 1024 * 1024 },
			(_error, _stdout, stderr) => {
				resolve({ stderr: typeof stderr === "string" ? stderr : "" });
			},
		);
	});
}

export async function probeCompanionAudioLevel(
	ffmpegPath: string,
	audioPath: string,
): Promise<CompanionAudioLevel> {
	const { stderr } = await runFfmpegProbe(ffmpegPath, [
		"-hide_banner",
		"-i",
		audioPath,
		"-t",
		String(PROBE_WINDOW_SECONDS),
		"-map",
		"0:a:0",
		"-af",
		"volumedetect",
		"-f",
		"null",
		"-",
	]);

	const { maxVolumeDb, meanVolumeDb } = parseVolumedetectOutput(stderr);
	if (maxVolumeDb === null) {
		throw new Error(`No audio levels could be measured for: ${audioPath}`);
	}

	return {
		path: audioPath,
		kind: classifyCompanionPath(audioPath),
		maxVolumeDb,
		meanVolumeDb,
	};
}

/**
 * Probe every usable companion sidecar of a recording. Returns per-file
 * levels; callers decide whether a silent system track is worth a warning.
 */
export async function probeCompanionAudioLevels(options: {
	videoPath: string;
}): Promise<CompanionAudioLevel[]> {
	const normalizedVideoPath = normalizeVideoSourcePath(options.videoPath);
	if (!normalizedVideoPath) {
		throw new Error("Missing source video path.");
	}

	const ffmpegPath = getFfmpegBinaryPath();
	const levels: CompanionAudioLevel[] = [];
	for (const candidate of await getUsableCompanionAudioCandidates(normalizedVideoPath)) {
		for (const companionPath of candidate.usablePaths) {
			try {
				levels.push(await probeCompanionAudioLevel(ffmpegPath, companionPath));
			} catch (error) {
				console.warn("[companion-audio-level] probe failed:", companionPath, error);
			}
		}
	}

	return levels;
}
