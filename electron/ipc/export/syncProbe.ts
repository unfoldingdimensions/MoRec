import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type { MuxDriftCorrection } from "../../../src/lib/audioDrift";
import { resolveMuxDriftCorrection } from "../../../src/lib/audioDrift";
import { getFfprobeBinaryPath } from "../ffmpeg/binary";

const execFileAsync = promisify(execFile);

export interface RecordingStreamDurations {
	videoDurationSec: number | null;
	audioDurationSec: number | null;
}

export interface RecordingStreamDurationsJson {
	streams?: Array<{
		codec_type?: string;
		duration?: string | number;
	}>;
}

function sanitizeStreamDurationSeconds(value: string | number | undefined): number | null {
	const parsed = typeof value === "number" ? value : Number(value);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/**
 * Pure parser for `ffprobe -show_entries stream=codec_type,duration -of json`
 * output: the first positive duration per stream kind wins. Missing or
 * unparsable durations stay null — callers must treat null as "unknown",
 * never as zero.
 */
export function parseRecordingStreamDurations(
	ffprobeJsonOutput: string,
): RecordingStreamDurations {
	let parsed: RecordingStreamDurationsJson;
	try {
		parsed = JSON.parse(ffprobeJsonOutput) as RecordingStreamDurationsJson;
	} catch {
		return { videoDurationSec: null, audioDurationSec: null };
	}

	const result: RecordingStreamDurations = {
		videoDurationSec: null,
		audioDurationSec: null,
	};
	for (const stream of parsed.streams ?? []) {
		const durationSec = sanitizeStreamDurationSeconds(stream.duration);
		if (durationSec === null) {
			continue;
		}
		if (stream.codec_type === "video" && result.videoDurationSec === null) {
			result.videoDurationSec = durationSec;
		} else if (stream.codec_type === "audio" && result.audioDurationSec === null) {
			result.audioDurationSec = durationSec;
		}
	}
	return result;
}

/**
 * Measures video and audio stream durations of one media file. Failures
 * (missing binary, unreadable file) resolve to null durations so callers can
 * degrade to "unknown" instead of failing an export over a probe.
 */
export async function probeRecordingStreamDurations(
	inputPath: string,
): Promise<RecordingStreamDurations> {
	try {
		const ffprobePath = getFfprobeBinaryPath();
		const result = await execFileAsync(
			ffprobePath,
			[
				"-v",
				"error",
				"-show_entries",
				"stream=codec_type,duration",
				"-of",
				"json",
				inputPath,
			],
			{ timeout: 30_000, maxBuffer: 2 * 1024 * 1024 },
		);
		return parseRecordingStreamDurations(result.stdout);
	} catch {
		return { videoDurationSec: null, audioDurationSec: null };
	}
}

export interface ResolveNativeMuxDriftTempoFactorParams {
	/** The muxed video file (only probed when outputDurationSec is unavailable). */
	videoPath: string;
	/** The audio input that will be muxed under the video. */
	audioInputPath: string;
	/** Renderer-computed effective output duration; the video timeline target. */
	outputDurationSec?: number | null;
	/** Recorded companion-audio start delay, when the caller knows it. */
	audioStartDelaySeconds?: number | null;
}

/**
 * Measures the mux inputs and decides whether the audio needs a drift
 * correction. Returns null when the streams are aligned within tolerance or
 * either duration is unknown — null means "mux unchanged", the safe default.
 */
export async function resolveNativeMuxDriftTempoFactor({
	videoPath,
	audioInputPath,
	outputDurationSec,
	audioStartDelaySeconds,
}: ResolveNativeMuxDriftTempoFactorParams): Promise<MuxDriftCorrection | null> {
	const audioDurations = await probeRecordingStreamDurations(audioInputPath);
	if (audioDurations.audioDurationSec === null) {
		return null;
	}

	const outputDurationSecFinite =
		typeof outputDurationSec === "number" &&
		Number.isFinite(outputDurationSec) &&
		outputDurationSec > 0
			? outputDurationSec
			: null;
	let videoDurationSec = outputDurationSecFinite;
	if (videoDurationSec === null) {
		const videoDurations = await probeRecordingStreamDurations(videoPath);
		videoDurationSec = videoDurations.videoDurationSec;
	}
	if (videoDurationSec === null) {
		return null;
	}

	return resolveMuxDriftCorrection({
		videoDurationSec,
		audioDurationSec: audioDurations.audioDurationSec,
		audioStartDelaySeconds,
	});
}
