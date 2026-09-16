import { execFile, spawnSync } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { app } from "electron";
import { getFfmpegBinaryPath } from "../ffmpeg/binary";
import { getBundledWhisperExecutableCandidates } from "../paths/binaries";
import { getUsableCompanionAudioCandidates } from "../recording/diagnostics";
import { resolveRecordingSession } from "../project/session";
import { approvedLocalExecutablePaths } from "../state";
import { normalizeVideoSourcePath } from "../utils";
import type { CaptionCuePayload } from "../types";
import { parseSrtCues, parseWhisperJsonCues, shouldRetryWhisperWithoutJson } from "./parser";
import { segmentCuesIntoPhrases } from "./segment";
import {
	parseSilenceIntervals,
	SILENCE_DETECT_MIN_S,
	SILENCE_NOISE_DB,
	type SilenceInterval,
} from "./silence";

const execFileAsync = promisify(execFile);

export async function ensureReadableFile(filePath: string, options?: { executable?: boolean }) {
	await fs.access(filePath, fsConstants.R_OK);
	if (options?.executable) {
		try {
			await fs.access(filePath, fsConstants.X_OK);
		} catch {
			throw new Error("The selected Whisper executable is not marked as executable.");
		}
	}
}

export async function isExecutableFile(filePath: string) {
	try {
		await fs.access(filePath, fsConstants.R_OK | fsConstants.X_OK);
		return true;
	} catch {
		return false;
	}
}

export async function resolveWhisperExecutablePath(preferredPath?: string | null) {
	// Threat model: `preferredPath` comes from the renderer and this function's
	// return value is handed to execFile. A compromised renderer must not be able
	// to point it at an arbitrary binary, so the preferred path only counts when
	// the user granted EXECUTION consent for it via the native Whisper executable
	// picker (`approvedLocalExecutablePaths`). Read consent (`approvedLocalReadPaths`,
	// granted by media pickers) does NOT qualify: a user can be talked into picking
	// a disguised executable as an "image" or "video", and read-consenting it must
	// never make it executable. An unapproved path falls through to the bundled,
	// env-var, and PATH candidates as if no preference had been sent.
	const preferred = preferredPath?.trim() || null;
	const preferredIsApprovedExecutable =
		preferred !== null && approvedLocalExecutablePaths.has(path.resolve(preferred));

	const candidatePaths = [
		preferredIsApprovedExecutable ? preferred : null,
		...getBundledWhisperExecutableCandidates(),
		process.env["WHISPER_CPP_PATH"]?.trim() || null,
		process.platform === "darwin" ? "/opt/homebrew/bin/whisper-cli" : null,
		process.platform === "darwin" ? "/usr/local/bin/whisper-cli" : null,
		process.platform === "darwin" ? "/opt/homebrew/bin/whisper-cpp" : null,
		process.platform === "darwin" ? "/usr/local/bin/whisper-cpp" : null,
	].filter((value): value is string => Boolean(value));

	for (const candidate of candidatePaths) {
		const normalized = path.resolve(candidate);
		if (await isExecutableFile(normalized)) {
			return normalized;
		}
	}

	const pathCommand = process.platform === "win32" ? "where" : "which";
	const binaryNames =
		process.platform === "win32"
			? ["whisper-cli.exe", "whisper.exe", "main.exe"]
			: ["whisper-cli", "whisper-cpp", "whisper", "main"];

	for (const binaryName of binaryNames) {
		const result = spawnSync(pathCommand, [binaryName], { encoding: "utf-8" });
		if (result.status === 0) {
			const resolvedPath = result.stdout
				.split(/\r?\n/)
				.map((line) => line.trim())
				.find(Boolean);

			if (resolvedPath && (await isExecutableFile(resolvedPath))) {
				return resolvedPath;
			}
		}
	}

	throw new Error(
		"No Whisper runtime was found. Mo Rec looked for a bundled binary first, then checked common system install locations.",
	);
}

export type CaptionAudioCandidate = {
	path: string;
	label: string;
	/** Only set for the webcam candidate: how far the webcam audio clock is shifted from the recording timeline. */
	timeOffsetMs?: number;
};

export async function resolveCaptionAudioCandidates(videoPath: string) {
	const candidates: CaptionAudioCandidate[] = [];
	const seenPaths = new Set<string>();

	const pushCandidate = (
		candidatePath: string | null | undefined,
		label: string,
		timeOffsetMs?: number,
	) => {
		const normalizedCandidatePath = normalizeVideoSourcePath(candidatePath);
		if (!normalizedCandidatePath || seenPaths.has(normalizedCandidatePath)) {
			return;
		}

		seenPaths.add(normalizedCandidatePath);
		candidates.push({
			path: normalizedCandidatePath,
			label,
			...(Number.isFinite(timeOffsetMs) ? { timeOffsetMs } : {}),
		});
	};

	pushCandidate(videoPath, "recording");

	// Companion sidecars (Windows .wav, macOS .m4a/.webm) are timeline-aligned with
	// the recording, and native Windows recordings carry no embedded audio at all,
	// so try them before the linked webcam track (whose audio is offset by the
	// webcam start time).
	const companionCandidates = await getUsableCompanionAudioCandidates(videoPath);
	for (const companion of companionCandidates) {
		for (const companionPath of companion.usablePaths) {
			pushCandidate(
				companionPath,
				companionPath === companion.systemPath
					? "system audio companion track"
					: "microphone companion track",
			);
		}
	}

	const requestedRecordingSession = await resolveRecordingSession(videoPath);
	pushCandidate(
		requestedRecordingSession?.webcamPath,
		"linked webcam recording",
		requestedRecordingSession?.timeOffsetMs,
	);

	return candidates;
}

/**
 * Webcam sidecar audio starts at the webcam's own t=0, which is offset from
 * the recording timeline by the session's timeOffsetMs (webcam start minus
 * screen start). Shift the parsed cues onto the timeline; cues pushed before
 * zero are clamped rather than leaked at negative times.
 */
export function shiftCuesByOffset(cues: CaptionCuePayload[], offsetMs: number): CaptionCuePayload[] {
	if (!Number.isFinite(offsetMs) || offsetMs === 0) {
		return cues;
	}

	const shifted: CaptionCuePayload[] = [];
	for (const cue of cues) {
		const startMs = Math.max(0, cue.startMs + offsetMs);
		const endMs = Math.max(startMs + 1, cue.endMs + offsetMs);
		if (cue.endMs + offsetMs <= 0) {
			continue;
		}
		const words = cue.words?.map((word) => ({
			...word,
			startMs: Math.max(0, word.startMs + offsetMs),
			endMs: Math.max(0, word.endMs + offsetMs),
		}));
		shifted.push({
			...cue,
			startMs,
			endMs,
			...(words && words.length > 0 ? { words } : {}),
		});
	}
	return shifted;
}

export async function extractCaptionAudioSource(options: {
	videoPath: string;
	ffmpegPath: string;
	wavPath: string;
}) {
	const candidates = await resolveCaptionAudioCandidates(options.videoPath);
	const attemptedCandidates: Array<{
		path: string;
		label: string;
		readable: boolean;
		extractedAudio: boolean;
		error?: string;
	}> = [];

	for (const candidate of candidates) {
		try {
			await ensureReadableFile(candidate.path);
			await execFileAsync(
				options.ffmpegPath,
				[
					"-y",
					"-i",
					candidate.path,
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
				{ timeout: 5 * 60 * 1000, maxBuffer: 20 * 1024 * 1024 },
			);
			attemptedCandidates.push({ ...candidate, readable: true, extractedAudio: true });
			return candidate;
		} catch (error) {
			attemptedCandidates.push({
				...candidate,
				readable: true,
				extractedAudio: false,
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}

	console.warn(
		"[auto-captions] No audio source candidate could be extracted:",
		attemptedCandidates,
	);

	throw new Error(
		"No audio was found to transcribe in the saved recording file. Captions need an audio track. If this recording should have contained sound, the recording was saved without an audio stream.",
	);
}

export async function detectSilenceIntervals(options: {
	ffmpegPath: string;
	wavPath: string;
}): Promise<SilenceInterval[]> {
	// ffmpeg writes silencedetect results to stderr; the null muxer just runs the filter.
	const { stderr } = await execFileAsync(
		options.ffmpegPath,
		[
			"-hide_banner",
			"-nostats",
			"-i",
			options.wavPath,
			"-af",
			`silencedetect=noise=${SILENCE_NOISE_DB}dB:d=${SILENCE_DETECT_MIN_S}`,
			"-f",
			"null",
			"-",
		],
		{ timeout: 5 * 60 * 1000, maxBuffer: 20 * 1024 * 1024 },
	);

	return parseSilenceIntervals(stderr ?? "");
}

export async function generateAutoCaptionsFromVideo(options: {
	videoPath: string;
	whisperExecutablePath?: string;
	whisperModelPath: string;
	language?: string;
}) {
	const ffmpegPath = getFfmpegBinaryPath();
	const normalizedVideoPath = normalizeVideoSourcePath(options.videoPath);
	if (!normalizedVideoPath) {
		throw new Error("Missing source video path.");
	}

	const whisperExecutablePath = await resolveWhisperExecutablePath(options.whisperExecutablePath);
	const whisperModelPath = path.resolve(options.whisperModelPath);
	await ensureReadableFile(whisperExecutablePath, { executable: true });
	await ensureReadableFile(whisperModelPath);

	const tempBase = path.join(
		app.getPath("temp"),
		`morec-captions-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
	);
	const wavPath = `${tempBase}.wav`;
	const outputBase = `${tempBase}-whisper`;
	const srtPath = `${outputBase}.srt`;
	const jsonPath = `${outputBase}.json`;

	try {
		const audioSource = await extractCaptionAudioSource({
			videoPath: normalizedVideoPath,
			ffmpegPath,
			wavPath,
		});

		const language =
			options.language && options.language.trim() ? options.language.trim() : "auto";
		const whisperBaseArgs = [
			"-m",
			whisperModelPath,
			"-f",
			wavPath,
			"-osrt",
			"-of",
			outputBase,
			"-l",
			language,
			"-np",
		];

		let jsonEnabled = true;
		try {
			await execFileAsync(whisperExecutablePath, [...whisperBaseArgs, "-ojf"], {
				timeout: 30 * 60 * 1000,
				maxBuffer: 20 * 1024 * 1024,
			});
		} catch (error) {
			if (!shouldRetryWhisperWithoutJson(error)) {
				throw error;
			}

			jsonEnabled = false;
			console.warn(
				"[auto-captions] Whisper runtime does not support JSON full output, retrying with SRT only:",
				error,
			);
			await execFileAsync(whisperExecutablePath, whisperBaseArgs, {
				timeout: 30 * 60 * 1000,
				maxBuffer: 20 * 1024 * 1024,
			});
		}

		const timedCues = jsonEnabled
			? parseWhisperJsonCues(await fs.readFile(jsonPath, "utf-8"))
			: [];
		if (jsonEnabled && timedCues.length === 0) {
			// JSON ran but yielded no word-timed cues (empty/malformed output). We fall back
			// to SRT, which has no word timings — captions are then split by sentence text and
			// silence rather than precise word timing. Surface it for diagnosis.
			console.warn(
				"[auto-captions] Whisper JSON produced no word-timed cues; falling back to SRT (no word timings).",
			);
		}
		const cues =
			timedCues.length > 0 ? timedCues : parseSrtCues(await fs.readFile(srtPath, "utf-8"));
		if (cues.length === 0) {
			throw new Error("Whisper completed, but no caption cues were produced.");
		}

		// Whisper cues run sentences together and don't break on pauses. Re-segment them
		// into one caption per sentence/phrase using Whisper's own word stream (punctuation
		// + pauses), backed by ground-truth acoustic silence (ffmpeg `silencedetect`).
		// Failure here must not block caption generation — fall back to raw.
		let cuesToReturn = cues;
		try {
			const silences = await detectSilenceIntervals({ ffmpegPath, wavPath });
			// An empty result is a valid resegmentation (e.g. every transcribed word fell
			// inside a long detected silence and was dropped as a hallucination), so take it
			// as-is. Only a thrown exception should fall back to the raw cues.
			cuesToReturn = segmentCuesIntoPhrases(cues, silences);
		} catch (error) {
			console.warn(
				"[auto-captions] Silence-aware re-segmentation failed, using raw cues:",
				error,
			);
		}

		// Webcam-sourced captions come back on the webcam's clock; move them onto
		// the recording timeline after segmentation (silences were detected on the
		// same extracted wav, so segmentation ran consistently in webcam time).
		cuesToReturn = shiftCuesByOffset(cuesToReturn, audioSource.timeOffsetMs ?? 0);

		return {
			cues: cuesToReturn,
			audioSourceLabel: audioSource.label,
		};
	} finally {
		await Promise.allSettled([
			fs.rm(wavPath, { force: true }),
			fs.rm(srtPath, { force: true }),
			fs.rm(jsonPath, { force: true }),
		]);
	}
}
