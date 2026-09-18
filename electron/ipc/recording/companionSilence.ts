import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { app } from "electron";
import { ensureReadableFile } from "../captions/generate";
import { getFfmpegBinaryPath } from "../ffmpeg/binary";
import { runSilenceDetect, type SilenceInterval } from "../ffmpeg/silencedetect";
import { normalizeVideoSourcePath } from "../utils";
import { getUsableCompanionAudioCandidates } from "./diagnostics";

const execFileAsync = promisify(execFile);

/**
 * Silence analysis for the editor's "Remove dead air" / "Speed up dead air"
 * one-click actions. Audio source preference mirrors caption audio but puts
 * the timeline-aligned companion sidecars first (Windows native recordings
 * carry no embedded audio at all): mic/system companion wav/m4a -> the
 * video's own embedded audio (extracted to a temp 16k mono wav, then deleted).
 */

export type CompanionSilenceSource = "system" | "mic" | "video";

export interface CompanionSilenceInterval {
	startMs: number;
	endMs: number;
}

export interface CompanionSilenceAnalysis {
	intervals: CompanionSilenceInterval[];
	usedSource: CompanionSilenceSource;
}

const SILENCE_ANALYSIS_TIMEOUT_MS = 5 * 60 * 1000;

function classifyCompanionPath(filePath: string): "system" | "mic" {
	return /\.mic\./i.test(filePath) ? "mic" : "system";
}

function clampIntervalEnd(
	interval: SilenceInterval,
	totalDurationMs: number | null,
): CompanionSilenceInterval | null {
	const startMs = Math.max(0, interval.startMs);
	let endMs = interval.endMs;
	if (!Number.isFinite(endMs)) {
		// Trailing silence runs to end-of-audio; IPC can't carry Infinity, so
		// clamp it to the recording duration and drop it when that is unknown.
		if (totalDurationMs === null || totalDurationMs <= startMs) {
			return null;
		}
		endMs = totalDurationMs;
	}
	return endMs > startMs ? { startMs, endMs: Math.round(endMs) } : null;
}

function finalizeIntervals(
	intervals: SilenceInterval[],
	totalDurationMs: number | null,
): CompanionSilenceInterval[] {
	return intervals
		.map((interval) => clampIntervalEnd(interval, totalDurationMs))
		.filter((interval): interval is CompanionSilenceInterval => interval !== null)
		.sort((left, right) => left.startMs - right.startMs);
}

async function detectSilenceInFile(audioPath: string): Promise<SilenceInterval[]> {
	return runSilenceDetect({ ffmpegPath: getFfmpegBinaryPath(), audioPath });
}

/**
 * Extract the video's own embedded audio to a 16k mono wav (the
 * `extractCaptionAudioSource` pattern) so silencedetect sees one predictable
 * input. The caller deletes the wav.
 */
export async function extractEmbeddedAudioToWav(options: {
	videoPath: string;
	ffmpegPath: string;
	wavPath: string;
}) {
	await execFileAsync(
		options.ffmpegPath,
		[
			"-y",
			"-i",
			options.videoPath,
			"-map",
			"0:a:0",
			"-vn",
			"-ac",
			"1",
			"-ar",
			"16000",
			"-c:a",
			"pcm_s16le",
			options.wavPath,
		],
		{ timeout: SILENCE_ANALYSIS_TIMEOUT_MS, maxBuffer: 20 * 1024 * 1024 },
	);
}

export async function analyzeCompanionAudioSilenceFromVideo(options: {
	videoPath: string;
	/** Recording duration in ms; bounds a trailing silence that never ends. */
	totalDurationMs?: number;
}): Promise<CompanionSilenceAnalysis> {
	const normalizedVideoPath = normalizeVideoSourcePath(options.videoPath);
	if (!normalizedVideoPath) {
		throw new Error("Missing source video path.");
	}

	const totalDurationMs =
		Number.isFinite(options.totalDurationMs) && (options.totalDurationMs ?? 0) > 0
			? Math.round(options.totalDurationMs as number)
			: null;
	const attempted: Array<{ path: string; error: string }> = [];

	for (const candidate of await getUsableCompanionAudioCandidates(normalizedVideoPath)) {
		for (const companionPath of candidate.usablePaths) {
			try {
				await ensureReadableFile(companionPath);
				const intervals = await detectSilenceInFile(companionPath);
				return {
					intervals: finalizeIntervals(intervals, totalDurationMs),
					usedSource: classifyCompanionPath(companionPath),
				};
			} catch (error) {
				attempted.push({
					path: companionPath,
					error: error instanceof Error ? error.message : String(error),
				});
			}
		}
	}

	// Fallback: the video's own embedded audio, extracted to a temp wav.
	const wavPath = path.join(
		app.getPath("temp"),
		`morec-silence-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.wav`,
	);
	try {
		await ensureReadableFile(normalizedVideoPath);
		await extractEmbeddedAudioToWav({
			videoPath: normalizedVideoPath,
			ffmpegPath: getFfmpegBinaryPath(),
			wavPath,
		});
		const intervals = await detectSilenceInFile(wavPath);
		return {
			intervals: finalizeIntervals(intervals, totalDurationMs),
			usedSource: "video",
		};
	} catch (error) {
		attempted.push({
			path: normalizedVideoPath,
			error: error instanceof Error ? error.message : String(error),
		});
		console.warn(
			"[companion-silence] No audio source candidate could be analyzed:",
			attempted,
		);
		throw new Error(
			"No audio was found to analyze in the saved recording file. Dead-air detection needs an audio track.",
		);
	} finally {
		await fs.rm(wavPath, { force: true }).catch(() => undefined);
	}
}
