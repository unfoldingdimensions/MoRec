import { describe, expect, it } from "vitest";

import {
	parseRecordingStreamDurations,
	resolveRecordingSyncAnalysis,
} from "./syncProbe";

const BOTH_STREAMS_JSON = JSON.stringify({
	streams: [
		{ index: 0, codec_name: "h264", codec_type: "video", duration: "2400.500000" },
		{ index: 1, codec_name: "aac", codec_type: "audio", duration: "2352.613061" },
	],
});

describe("parseRecordingStreamDurations", () => {
	it("reads the first positive duration per stream kind", () => {
		expect(parseRecordingStreamDurations(BOTH_STREAMS_JSON)).toEqual({
			videoDurationSec: 2400.5,
			audioDurationSec: 2352.613061,
		});
	});

	it("keeps stream kinds independent and ignores later duplicates", () => {
		const output = parseRecordingStreamDurations(
			JSON.stringify({
				streams: [
					{ codec_type: "audio", duration: "10.0" },
					{ codec_type: "video", duration: "12.5" },
					{ codec_type: "audio", duration: "99.0" },
					{ codec_type: "video", duration: "bad" },
				],
			}),
		);
		expect(output).toEqual({ videoDurationSec: 12.5, audioDurationSec: 10.0 });
	});

	it("treats missing, zero, and non-numeric durations as unknown", () => {
		expect(
			parseRecordingStreamDurations(
				JSON.stringify({
					streams: [
						{ codec_type: "video" },
						{ codec_type: "audio", duration: "0" },
					],
				}),
			),
		).toEqual({ videoDurationSec: null, audioDurationSec: null });
	});

	it("treats malformed JSON as unknown instead of throwing", () => {
		expect(parseRecordingStreamDurations("not json at all")).toEqual({
			videoDurationSec: null,
			audioDurationSec: null,
		});
		expect(parseRecordingStreamDurations("")).toEqual({
			videoDurationSec: null,
			audioDurationSec: null,
		});
	});

	it("accepts numeric durations, not only strings", () => {
		expect(
			parseRecordingStreamDurations(
				JSON.stringify({
					streams: [{ codec_type: "audio", duration: 7.25 }],
				}),
			),
		).toEqual({ videoDurationSec: null, audioDurationSec: 7.25 });
	});
});

describe("resolveRecordingSyncAnalysis", () => {
	it("reports a deliberately drifted long recording", () => {
		const analysis = resolveRecordingSyncAnalysis({
			videoDurations: { videoDurationSec: 2_400, audioDurationSec: 2_400 },
			companionAudioDurations: {
				videoDurationSec: null,
				audioDurationSec: 2_352,
			},
		});
		expect(analysis.status).toBe("drifted");
		expect(analysis.driftSeconds).toBeCloseTo(-48, 5);
		expect(analysis.maxAbsDriftSeconds).toBeCloseTo(48, 5);
		expect(analysis.audioDurationSec).toBe(2_352);
	});

	it("keeps an aligned recording aligned", () => {
		const analysis = resolveRecordingSyncAnalysis({
			videoDurations: { videoDurationSec: 600, audioDurationSec: 600 },
		});
		expect(analysis.status).toBe("aligned");
	});

	it("degrades to unknown when nothing is measurable", () => {
		const analysis = resolveRecordingSyncAnalysis({
			videoDurations: { videoDurationSec: null, audioDurationSec: null },
		});
		expect(analysis.status).toBe("unknown");
		expect(analysis.driftSeconds).toBeNull();
		expect(analysis.maxAbsDriftSeconds).toBeNull();
	});

	it("prefers companion audio over the embedded stream", () => {
		const analysis = resolveRecordingSyncAnalysis({
			videoDurations: { videoDurationSec: 600, audioDurationSec: 600 },
			companionAudioDurations: {
				videoDurationSec: null,
				audioDurationSec: 590,
			},
		});
		expect(analysis.status).toBe("drifted");
		expect(analysis.audioDurationSec).toBe(590);
	});

	it("falls back to the embedded audio stream without a companion probe", () => {
		const analysis = resolveRecordingSyncAnalysis({
			videoDurations: { videoDurationSec: 600, audioDurationSec: 480 },
			companionAudioDurations: null,
		});
		expect(analysis.status).toBe("drifted");
		expect(analysis.driftSeconds).toBeCloseTo(-120, 5);
	});
});
