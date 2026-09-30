import { describe, expect, it } from "vitest";
import fc from "fast-check";

import {
	AUDIO_DRIFT_TOLERANCE_SECONDS,
	analyzeTimelineDrift,
	applyDriftCorrectionToTimestampsSec,
	computeDriftTempoFactor,
	resolveMuxDriftCorrection,
} from "./audioDrift";

const FORTY_MINUTES_SEC = 40 * 60;

/** Video timeline sampled at 30 fps, audio at 50 Hz, both covering the same content. */
function buildSyntheticLongTimelines(options: {
	durationSec: number;
	audioClockRate: number;
	dropAudioRunEverySamples?: number;
	dropRunLengthSamples?: number;
}) {
	const videoFps = 30;
	const audioHz = 50;
	const videoSampleCount = Math.floor(options.durationSec * videoFps) + 1;
	const audioSampleCount = Math.floor(options.durationSec * audioHz) + 1;

	const videoTimesSec: number[] = [];
	for (let index = 0; index < videoSampleCount; index += 1) {
		videoTimesSec.push(index / videoFps);
	}

	const audioTimesSec: number[] = [];
	let sourceSampleIndex = 0;
	let droppedSeconds = 0;
	let samplesUntilDrop = options.dropAudioRunEverySamples ?? Number.POSITIVE_INFINITY;
	for (let index = 0; index < audioSampleCount; index += 1) {
		const contentTimeSec = sourceSampleIndex / audioHz;
		// Compaction makes the written audio timeline lag the content it
		// represents: the sound belonging at video-time T shows up in the WAV
		// at T − (seconds compacted away so far).
		audioTimesSec.push(
			Math.max(0, contentTimeSec * options.audioClockRate - droppedSeconds),
		);
		sourceSampleIndex += 1;
		samplesUntilDrop -= 1;
		if (samplesUntilDrop <= 0) {
			// The capture helper dropped this run entirely, so every later
			// sample is stamped earlier by the run's duration.
			droppedSeconds += (options.dropRunLengthSamples ?? 0) / audioHz;
			samplesUntilDrop = options.dropAudioRunEverySamples ?? Number.POSITIVE_INFINITY;
		}
	}

	return { videoTimesSec, audioTimesSec };
}

describe("analyzeTimelineDrift — synthetic long-duration timelines", () => {
	it("reports the accumulating drift of a slow audio clock over 40 minutes", () => {
		// +0.2% audio clock error ≈ 2 ms per second ⇒ ≈ 4.8 s of drift by the end.
		const { videoTimesSec, audioTimesSec } = buildSyntheticLongTimelines({
			durationSec: FORTY_MINUTES_SEC,
			audioClockRate: 1.002,
		});
		expect(videoTimesSec.length).toBeGreaterThan(70_000);
		expect(audioTimesSec.length).toBeGreaterThan(119_000);

		const analysis = analyzeTimelineDrift({ videoTimesSec, audioTimesSec });
		expect(analysis).not.toBeNull();
		expect(analysis!.exceedsTolerance).toBe(true);
		expect(analysis!.maxAbsDriftSeconds).toBeGreaterThan(4);
		expect(analysis!.driftSeconds).toBeGreaterThan(4);
	});

	it("reports compaction losses over 40 minutes", () => {
		// Drop 3 of every ~1,800 audio samples (60 ms dropped each ~36 s) — the
		// silent-discontinuity compaction pattern — ≈ 4 s lost by the end.
		const { videoTimesSec, audioTimesSec } = buildSyntheticLongTimelines({
			durationSec: FORTY_MINUTES_SEC,
			audioClockRate: 1,
			dropAudioRunEverySamples: 1_800,
			dropRunLengthSamples: 3,
		});

		const analysis = analyzeTimelineDrift({ videoTimesSec, audioTimesSec });
		expect(analysis).not.toBeNull();
		expect(analysis!.exceedsTolerance).toBe(true);
		expect(analysis!.driftSeconds).toBeLessThan(-3);
	});

	it("bounds drift within tolerance after the tempo correction for the whole 40 minutes", () => {
		const driftedVariants = [
			buildSyntheticLongTimelines({ durationSec: FORTY_MINUTES_SEC, audioClockRate: 1.002 }),
			buildSyntheticLongTimelines({
				durationSec: FORTY_MINUTES_SEC,
				audioClockRate: 1,
				dropAudioRunEverySamples: 1_800,
				dropRunLengthSamples: 3,
			}),
			buildSyntheticLongTimelines({ durationSec: FORTY_MINUTES_SEC, audioClockRate: 0.997 }),
		];

		for (const { videoTimesSec, audioTimesSec } of driftedVariants) {
			const before = analyzeTimelineDrift({ videoTimesSec, audioTimesSec });
			expect(before!.exceedsTolerance).toBe(true);

			const tempoFactor = computeDriftTempoFactor({
				videoDurationSec: videoTimesSec[videoTimesSec.length - 1],
				audioDurationSec: audioTimesSec[audioTimesSec.length - 1],
			});
			expect(tempoFactor).not.toBeNull();

			const corrected = applyDriftCorrectionToTimestampsSec(audioTimesSec, tempoFactor!);
			const after = analyzeTimelineDrift({ videoTimesSec, audioTimesSec: corrected });
			expect(after).not.toBeNull();
			// This is the regression assertion that matters: after the mux-time
			// correction, no point of a 40-minute recording may exceed the
			// lip-sync tolerance.
			expect(after!.maxAbsDriftSeconds).toBeLessThanOrEqual(AUDIO_DRIFT_TOLERANCE_SECONDS);
			expect(after!.exceedsTolerance).toBe(false);
		}
	});
});

describe("analyzeTimelineDrift — duration form", () => {
	it("flags a long recording whose audio runs short beyond tolerance", () => {
		const analysis = analyzeTimelineDrift({
			videoDurationSec: FORTY_MINUTES_SEC,
			audioDurationSec: FORTY_MINUTES_SEC - 47.9,
		});
		expect(analysis!.exceedsTolerance).toBe(true);
		expect(analysis!.driftSeconds).toBeCloseTo(-47.9, 5);
		expect(analysis!.maxAbsDriftSeconds).toBeCloseTo(47.9, 5);
	});

	it("treats a small shortfall as a plausible start delay, not drift", () => {
		const analysis = analyzeTimelineDrift({
			videoDurationSec: FORTY_MINUTES_SEC,
			audioDurationSec: FORTY_MINUTES_SEC - 0.3,
		});
		expect(analysis!.exceedsTolerance).toBe(false);
		expect(analysis!.driftSeconds).toBeCloseTo(0, 5);
	});

	it("subtracts an explicitly recorded start delay before measuring", () => {
		const analysis = analyzeTimelineDrift({
			videoDurationSec: FORTY_MINUTES_SEC,
			audioDurationSec: FORTY_MINUTES_SEC - 1,
			audioStartDelaySeconds: 2,
		});
		expect(analysis!.driftSeconds).toBeCloseTo(1, 5);
		expect(analysis!.exceedsTolerance).toBe(true);
	});

	it("flags audio that runs long even without a start delay", () => {
		const analysis = analyzeTimelineDrift({
			videoDurationSec: FORTY_MINUTES_SEC,
			audioDurationSec: FORTY_MINUTES_SEC + 2,
		});
		expect(analysis!.exceedsTolerance).toBe(true);
		expect(analysis!.driftSeconds).toBeCloseTo(2, 5);
	});
});

describe("analyzeTimelineDrift — sample form", () => {
	it("measures a uniform start offset from sample timelines", () => {
		const videoTimesSec = [0, 1, 2, 3, 4];
		const audioTimesSec = [0.1, 1.1, 2.1, 3.1, 4.1];
		const analysis = analyzeTimelineDrift({ videoTimesSec, audioTimesSec });
		expect(analysis!.driftSeconds).toBeCloseTo(0.1, 5);
		expect(analysis!.maxAbsDriftSeconds).toBeCloseTo(0.1, 5);
		expect(analysis!.exceedsTolerance).toBe(true);
	});

	it("keeps a sub-tolerance offset unflagged", () => {
		const videoTimesSec = [0, 1, 2, 3, 4];
		const audioTimesSec = [0.05, 1.05, 2.05, 3.05, 4.05];
		const analysis = analyzeTimelineDrift({ videoTimesSec, audioTimesSec });
		expect(analysis!.exceedsTolerance).toBe(false);
	});

	it("treats drift exactly at tolerance as within tolerance", () => {
		const analysis = analyzeTimelineDrift({
			videoDurationSec: 100,
			audioDurationSec: 100 + AUDIO_DRIFT_TOLERANCE_SECONDS,
		});
		expect(analysis!.maxAbsDriftSeconds).toBeCloseTo(AUDIO_DRIFT_TOLERANCE_SECONDS, 6);
		expect(analysis!.exceedsTolerance).toBe(false);
	});
});

describe("analyzeTimelineDrift — unusable inputs", () => {
	it("returns null instead of pretending alignment", () => {
		expect(analyzeTimelineDrift({})).toBeNull();
		expect(analyzeTimelineDrift({ videoDurationSec: 0, audioDurationSec: 10 })).toBeNull();
		expect(
			analyzeTimelineDrift({ videoDurationSec: 10, audioDurationSec: Number.NaN }),
		).toBeNull();
		expect(analyzeTimelineDrift({ videoTimesSec: [], audioTimesSec: [1, 2] })).toBeNull();
		expect(
			analyzeTimelineDrift({ videoTimesSec: [0, 1], audioTimesSec: [Number.NaN, 2] }),
		).toBeNull();
		expect(
			analyzeTimelineDrift({ videoTimesSec: [0, -1], audioTimesSec: [0, 1] }),
		).toBeNull();
	});
});

describe("computeDriftTempoFactor", () => {
	it("returns audio-over-video for drifted streams", () => {
		expect(
			computeDriftTempoFactor({ videoDurationSec: 100, audioDurationSec: 101 }),
		).toBeCloseTo(1.01, 10);
		expect(
			computeDriftTempoFactor({ videoDurationSec: 100, audioDurationSec: 97 }),
		).toBeCloseTo(0.97, 10);
	});

	it("subtracts a known start delay from the audio content", () => {
		expect(
			computeDriftTempoFactor({
				videoDurationSec: 100,
				audioDurationSec: 102,
				audioStartDelaySeconds: 2,
			}),
		).toBeCloseTo(1, 10);
	});

	it("clamps absurd factors into the realizable atempo range", () => {
		expect(
			computeDriftTempoFactor({ videoDurationSec: 10, audioDurationSec: 1_000 }),
		).toBeLessThanOrEqual(4);
		expect(
			computeDriftTempoFactor({ videoDurationSec: 1_000, audioDurationSec: 0.01 }),
		).toBeGreaterThanOrEqual(0.25);
	});

	it("returns null for unusable durations", () => {
		expect(computeDriftTempoFactor({ videoDurationSec: 0, audioDurationSec: 10 })).toBeNull();
		expect(
			computeDriftTempoFactor({ videoDurationSec: 10, audioDurationSec: null }),
		).toBeNull();
	});
});

describe("resolveMuxDriftCorrection", () => {
	it("returns null when the streams are aligned within tolerance", () => {
		expect(
			resolveMuxDriftCorrection({
				videoDurationSec: FORTY_MINUTES_SEC,
				audioDurationSec: FORTY_MINUTES_SEC - 0.03,
			}),
		).toBeNull();
	});

	it("returns a correction for drifted streams without a recorded start delay", () => {
		const correction = resolveMuxDriftCorrection({
			videoDurationSec: FORTY_MINUTES_SEC,
			audioDurationSec: FORTY_MINUTES_SEC - 47.9,
		});
		expect(correction).not.toBeNull();
		expect(correction!.tempoFactor).toBeLessThan(1);
		expect(correction!.analysis.exceedsTolerance).toBe(true);
	});

	it("returns null when inputs are unknown", () => {
		expect(resolveMuxDriftCorrection({ videoDurationSec: null, audioDurationSec: 10 })).toBeNull();
		expect(resolveMuxDriftCorrection({ videoDurationSec: 10 })).toBeNull();
	});
});

describe("applyDriftCorrectionToTimestampsSec — fast-check invariants", () => {
	const strictlyIncreasingTimes = fc
		.array(fc.integer({ min: 0, max: 2_000_000 }), { minLength: 1, maxLength: 500 })
		.map((ints) => Array.from(new Set(ints)).sort((a, b) => a - b));
	const positiveFactor = fc
		.tuple(
			fc.double({ min: 0.5, max: 100, noNaN: true, noDefaultInfinity: true }),
			fc.double({ min: 0.5, max: 100, noNaN: true, noDefaultInfinity: true }),
		)
		.filter(([video, audio]) => audio / video >= 0.25 && audio / video <= 4)
		.map(([video, audio]) => audio / video);

	it("preserves strict ordering — no sample is ever reordered", () => {
		fc.assert(
			fc.property(strictlyIncreasingTimes, positiveFactor, (times, factor) => {
				const corrected = applyDriftCorrectionToTimestampsSec(times, factor);
				expect(corrected).toHaveLength(times.length);
				for (let index = 1; index < corrected.length; index += 1) {
					expect(corrected[index]).toBeGreaterThan(corrected[index - 1]);
				}
			}),
		);
	});

	it("is elementwise monotone: larger inputs map to larger-or-equal outputs", () => {
		fc.assert(
			fc.property(
				fc.array(
					fc.double({ min: 0, max: 10_000, noNaN: true, noDefaultInfinity: true }),
					{ minLength: 2, maxLength: 200 },
				),
				positiveFactor,
				(times, factor) => {
					const corrected = applyDriftCorrectionToTimestampsSec([...times].sort((a, b) => a - b), factor);
					for (let index = 1; index < corrected.length; index += 1) {
						expect(corrected[index]).toBeGreaterThanOrEqual(corrected[index - 1]);
					}
				},
			),
		);
	});

	it("maps each sample through t / factor exactly", () => {
		fc.assert(
			fc.property(strictlyIncreasingTimes, positiveFactor, (times, factor) => {
				const corrected = applyDriftCorrectionToTimestampsSec(times, factor);
				times.forEach((time, index) => {
					expect(corrected[index]).toBeCloseTo(time / factor, 9);
				});
			}),
		);
	});

	it("passes non-positive or non-finite factors through unchanged", () => {
		fc.assert(
			fc.property(
				fc.array(fc.double({ min: 0, max: 1_000 }), { minLength: 1, maxLength: 50 }),
				fc.oneof(
					fc.constant(0),
					fc.constant(-1.5),
					fc.constant(Number.NaN),
					fc.constant(Number.POSITIVE_INFINITY),
				),
				(times, factor) => {
					expect(applyDriftCorrectionToTimestampsSec(times, factor)).toEqual(times);
				},
			),
		);
	});
});
