import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * Shared ffmpeg `silencedetect` plumbing. Used by the caption pipeline
 * (re-segmentation) and the companion-audio silence analyzer (dead-air
 * trims / speed regions).
 */

/** ffmpeg `silencedetect` noise floor. Quieter than this counts as silence. */
export const SILENCE_NOISE_DB = -30;
/** ffmpeg `silencedetect` minimum silence duration (seconds) it should report at all. */
export const SILENCE_DETECT_MIN_S = 0.5;

export interface SilenceInterval {
	startMs: number;
	/** `Number.POSITIVE_INFINITY` for a trailing silence that runs to end-of-audio. */
	endMs: number;
}

/**
 * Parse ffmpeg `silencedetect` stderr into ordered, non-overlapping silence intervals.
 * Lines look like:
 *   [silencedetect @ 0x..] silence_start: 12.34
 *   [silencedetect @ 0x..] silence_end: 15.67 | silence_duration: 3.33
 */
export function parseSilenceIntervals(stderr: string): SilenceInterval[] {
	const intervals: SilenceInterval[] = [];
	let pendingStartMs: number | null = null;

	for (const line of stderr.split(/\r?\n/)) {
		const startMatch = line.match(/silence_start:\s*(-?[\d.]+)/);
		if (startMatch) {
			pendingStartMs = Math.max(0, Math.round(Number.parseFloat(startMatch[1]) * 1000));
			continue;
		}

		const endMatch = line.match(/silence_end:\s*(-?[\d.]+)/);
		if (endMatch && pendingStartMs !== null) {
			const endMs = Math.round(Number.parseFloat(endMatch[1]) * 1000);
			if (endMs > pendingStartMs) {
				intervals.push({ startMs: pendingStartMs, endMs });
			}
			pendingStartMs = null;
		}
	}

	// A trailing silence_start with no matching end runs to the end of the audio.
	if (pendingStartMs !== null) {
		intervals.push({ startMs: pendingStartMs, endMs: Number.POSITIVE_INFINITY });
	}

	return intervals.sort((left, right) => left.startMs - right.startMs);
}

/**
 * Run `silencedetect` over one audio file and parse its stderr. The caller is
 * responsible for the input being readable and audio-carrying.
 */
export async function runSilenceDetect(options: {
	ffmpegPath: string;
	audioPath: string;
	minDurationS?: number;
}): Promise<SilenceInterval[]> {
	// ffmpeg writes silencedetect results to stderr; the null muxer just runs the filter.
	const { stderr } = await execFileAsync(
		options.ffmpegPath,
		[
			"-hide_banner",
			"-nostats",
			"-i",
			options.audioPath,
			"-af",
			`silencedetect=noise=${SILENCE_NOISE_DB}dB:d=${options.minDurationS ?? SILENCE_DETECT_MIN_S}`,
			"-f",
			"null",
			"-",
		],
		{ timeout: 5 * 60 * 1000, maxBuffer: 20 * 1024 * 1024 },
	);

	return parseSilenceIntervals(stderr ?? "");
}
