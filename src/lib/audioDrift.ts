import { estimateCompanionAudioStartDelaySeconds } from "./mediaTiming";

/**
 * Drift above this value is surfaced to the user by the pre-export integrity
 * check and corrected at mux time. 80 ms is the point where lip-sync error
 * becomes noticeable, and it is far above the sub-frame jitter the capture
 * helpers produce on healthy runs.
 */
export const AUDIO_DRIFT_TOLERANCE_SECONDS = 0.08;

/**
 * Hard bounds for a tempo-based correction. The capture paths only ever need
 * factors near 1 (compaction and clock drift accumulate slowly), but the bounds
 * keep a bogus probe from scheduling an absurd time-stretch. `atempo` itself
 * accepts 0.5–2 per step and `buildAtempoFilters` chains steps, so anything in
 * these bounds is realizable.
 */
export const MIN_DRIFT_TEMPO_FACTOR = 0.25;
export const MAX_DRIFT_TEMPO_FACTOR = 4;

export interface TimelineDriftAnalysis {
	/** Signed drift at the aligned end: positive = audio runs long, negative = audio falls short. */
	driftSeconds: number;
	/** Largest |drift| observed across the aligned timeline. For linear accumulation this is the end value. */
	maxAbsDriftSeconds: number;
	exceedsTolerance: boolean;
}

export interface AnalyzeTimelineDriftOptions {
	/** Video timestamps in seconds, non-decreasing. */
	videoTimesSec?: number[] | null;
	/** Audio timestamps in seconds, non-decreasing, same content as the video timeline. */
	audioTimesSec?: number[] | null;
	/** Video stream duration in seconds (duration form when timelines are absent). */
	videoDurationSec?: number | null;
	/** Audio stream duration in seconds (duration form when timelines are absent). */
	audioDurationSec?: number | null;
	/**
	 * Recorded companion-audio start delay in seconds. A late start shortens the
	 * audio's on-timeline span without being drift, so it is subtracted before
	 * comparing durations. Defaults to the shared inference heuristic.
	 */
	audioStartDelaySeconds?: number | null;
	toleranceSeconds?: number;
}

function sanitizePositiveSeconds(value: number | null | undefined): number | null {
	return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function sanitizeTimesSec(timesSec: number[] | null | undefined): number[] | null {
	if (!Array.isArray(timesSec) || timesSec.length === 0) {
		return null;
	}
	return timesSec.every((time) => typeof time === "number" && Number.isFinite(time) && time >= 0)
		? timesSec
		: null;
}

/**
 * Expected audio time for audio sample `audioIndex`, read off the video
 * timeline by index fraction: both arrays cover the same content, each sampled
 * at its own rate, so fraction-of-content is the shared axis.
 */
function expectedVideoTimeForAudioIndex(
	videoTimesSec: number[],
	videoLength: number,
	audioIndex: number,
	audioLength: number,
): number {
	if (audioLength <= 1) {
		return videoTimesSec[0];
	}
	const fraction = audioIndex / (audioLength - 1);
	const videoIndex = Math.min(videoLength - 1, Math.round(fraction * (videoLength - 1)));
	return videoTimesSec[videoIndex];
}

/**
 * Measures how far an audio stream has drifted off the video timeline and
 * whether the drift exceeds the correction tolerance.
 *
 * Two input forms:
 * - sample timelines (both `videoTimesSec` and `audioTimesSec`): per-sample
 *   alignment by index fraction, `maxAbsDriftSeconds` is a true maximum;
 * - stream durations: drift is `audioDuration − (videoDuration − startDelay)`
 *   and, because capture drift accumulates linearly, the end value is also the
 *   maximum.
 *
 * Returns null when the inputs cannot support a measurement — callers must
 * treat null as "unknown", never as "aligned".
 */
export function analyzeTimelineDrift({
	videoTimesSec,
	audioTimesSec,
	videoDurationSec,
	audioDurationSec,
	audioStartDelaySeconds,
	toleranceSeconds = AUDIO_DRIFT_TOLERANCE_SECONDS,
}: AnalyzeTimelineDriftOptions): TimelineDriftAnalysis | null {
	const safeToleranceSeconds =
		typeof toleranceSeconds === "number" && Number.isFinite(toleranceSeconds) && toleranceSeconds >= 0
			? toleranceSeconds
			: AUDIO_DRIFT_TOLERANCE_SECONDS;
	const safeVideoTimes = sanitizeTimesSec(videoTimesSec);
	const safeAudioTimes = sanitizeTimesSec(audioTimesSec);

	if (safeVideoTimes && safeAudioTimes) {
		let maxAbsDrift = 0;
		let endDrift = 0;
		for (let index = 0; index < safeAudioTimes.length; index += 1) {
			const expectedVideoTime = expectedVideoTimeForAudioIndex(
				safeVideoTimes,
				safeVideoTimes.length,
				index,
				safeAudioTimes.length,
			);
			const drift = safeAudioTimes[index] - expectedVideoTime;
			maxAbsDrift = Math.max(maxAbsDrift, Math.abs(drift));
			endDrift = drift;
		}
		return {
			driftSeconds: endDrift,
			maxAbsDriftSeconds: maxAbsDrift,
			exceedsTolerance: maxAbsDrift > safeToleranceSeconds,
		};
	}

	const safeVideoDuration = sanitizePositiveSeconds(videoDurationSec);
	const safeAudioDuration = sanitizePositiveSeconds(audioDurationSec);
	if (!safeVideoDuration || !safeAudioDuration) {
		return null;
	}

	const startDelaySeconds =
		typeof audioStartDelaySeconds === "number" && Number.isFinite(audioStartDelaySeconds)
			? Math.max(0, audioStartDelaySeconds)
			: estimateCompanionAudioStartDelaySeconds(
					safeVideoDuration,
					safeAudioDuration,
					undefined,
				);
	const expectedAudioDurationSeconds = Math.max(0, safeVideoDuration - startDelaySeconds);
	const driftSeconds = safeAudioDuration - expectedAudioDurationSeconds;

	return {
		driftSeconds,
		maxAbsDriftSeconds: Math.abs(driftSeconds),
		exceedsTolerance: Math.abs(driftSeconds) > safeToleranceSeconds,
	};
}

export interface MuxDriftCorrection {
	/** `atempo` factor: >1 speeds long audio up, <1 slows short audio down. */
	tempoFactor: number;
	/** The analysis the factor was derived from, for logging/metrics. */
	analysis: TimelineDriftAnalysis;
}

export interface ComputeDriftTempoFactorOptions {
	videoDurationSec: number | null | undefined;
	audioDurationSec: number | null | undefined;
	audioStartDelaySeconds?: number | null;
}

/**
 * The `atempo` factor that makes the audio content span exactly the video
 * duration: audioContentDuration / videoDuration. >1 speeds long audio up,
 * <1 slows short audio down. Returns null for unusable durations.
 */
export function computeDriftTempoFactor({
	videoDurationSec,
	audioDurationSec,
	audioStartDelaySeconds,
}: ComputeDriftTempoFactorOptions): number | null {
	const safeVideoDuration = sanitizePositiveSeconds(videoDurationSec);
	const safeAudioDuration = sanitizePositiveSeconds(audioDurationSec);
	if (!safeVideoDuration || !safeAudioDuration) {
		return null;
	}

	const startDelaySeconds =
		typeof audioStartDelaySeconds === "number" &&
		Number.isFinite(audioStartDelaySeconds) &&
		audioStartDelaySeconds >= 0
			? audioStartDelaySeconds
			: 0;
	const audioContentDurationSeconds = Math.max(0.001, safeAudioDuration - startDelaySeconds);
	const rawFactor = audioContentDurationSeconds / safeVideoDuration;

	return Math.min(MAX_DRIFT_TEMPO_FACTOR, Math.max(MIN_DRIFT_TEMPO_FACTOR, rawFactor));
}

export interface ResolveMuxDriftCorrectionOptions {
	videoDurationSec: number | null | undefined;
	audioDurationSec: number | null | undefined;
	audioStartDelaySeconds?: number | null;
	toleranceSeconds?: number;
}

/**
 * Decides whether the mux needs a tempo correction and computes its factor.
 * Returns null when the streams are aligned within tolerance or the inputs are
 * unusable — null means "leave the audio untouched", the safe default.
 */
export function resolveMuxDriftCorrection({
	videoDurationSec,
	audioDurationSec,
	audioStartDelaySeconds,
	toleranceSeconds = AUDIO_DRIFT_TOLERANCE_SECONDS,
}: ResolveMuxDriftCorrectionOptions): MuxDriftCorrection | null {
	const safeVideoDuration = sanitizePositiveSeconds(videoDurationSec);
	const safeAudioDuration = sanitizePositiveSeconds(audioDurationSec);
	if (!safeVideoDuration || !safeAudioDuration) {
		return null;
	}

	// The correction decision uses the recorded start delay when it is known so
	// a late-starting track is not mistaken for drift; without one, fall back to
	// zero rather than the inference heuristic — inferring the delay from the
	// very shortfall the correction is about to "fix" would cancel real drift.
	const startDelaySeconds =
		typeof audioStartDelaySeconds === "number" &&
		Number.isFinite(audioStartDelaySeconds) &&
		audioStartDelaySeconds >= 0
			? audioStartDelaySeconds
			: 0;

	const analysis = analyzeTimelineDrift({
		videoDurationSec: safeVideoDuration,
		audioDurationSec: safeAudioDuration,
		audioStartDelaySeconds: startDelaySeconds,
		toleranceSeconds,
	});
	if (!analysis || !analysis.exceedsTolerance) {
		return null;
	}

	const tempoFactor = computeDriftTempoFactor({
		videoDurationSec: safeVideoDuration,
		audioDurationSec: safeAudioDuration,
		audioStartDelaySeconds: startDelaySeconds,
	});
	if (tempoFactor === null) {
		return null;
	}

	return { tempoFactor, analysis };
}

/**
 * Maps audio timestamps through the same transformation `atempo=tempoFactor`
 * applies to samples: a source-time t plays at t / factor in the output.
 * Monotone and order-preserving for every positive factor.
 */
export function applyDriftCorrectionToTimestampsSec(
	timesSec: number[],
	tempoFactor: number,
): number[] {
	if (!Number.isFinite(tempoFactor) || tempoFactor <= 0) {
		return [...timesSec];
	}

	return timesSec.map((time) => time / tempoFactor);
}
