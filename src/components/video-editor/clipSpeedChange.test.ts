import { describe, expect, it } from "vitest";

import {
	type BlockedClipSpeedChange,
	formatClipSpeedLabel,
	planClipSpeedChange,
} from "./clipSpeedChange";
import type { AnnotationRegion, AudioRegion, SpeedRegion } from "./types";

describe("formatClipSpeedLabel", () => {
	it("returns labels only for non-default positive speeds", () => {
		expect(formatClipSpeedLabel(1)).toBeNull();
		expect(formatClipSpeedLabel(0)).toBeNull();
		expect(formatClipSpeedLabel(-1)).toBeNull();
		expect(formatClipSpeedLabel(Number.POSITIVE_INFINITY)).toBeNull();
		expect(formatClipSpeedLabel(Number.NaN)).toBeNull();
		expect(formatClipSpeedLabel(0.5)).toBe("0.5x");
		expect(formatClipSpeedLabel(2)).toBe("2x");
	});
});

describe("planClipSpeedChange", () => {
	it("returns null for missing clips and invalid speeds", () => {
		const clipRegions = [{ id: "clip-1", startMs: 0, endMs: 5_000, speed: 1 }];

		expect(
			planClipSpeedChange({
				clipRegions,
				zoomRegions: [],
				audioRegions: [],
				annotationRegions: [],
				speedRegions: [],
				captions: [],
				selectedClipId: "missing",
				speed: 0.5,
			}),
		).toBeNull();

		for (const speed of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
			expect(
				planClipSpeedChange({
					clipRegions,
					zoomRegions: [],
					audioRegions: [],
					annotationRegions: [],
					speedRegions: [],
					captions: [],
					selectedClipId: "clip-1",
					speed,
				}),
			).toBeNull();
		}
	});

	it("extends an isolated clip when slowing it down", () => {
		const result = planClipSpeedChange({
			clipRegions: [{ id: "clip-1", startMs: 0, endMs: 5_000, speed: 1 }],
			zoomRegions: [],
			audioRegions: [],
			annotationRegions: [],
			speedRegions: [],
			captions: [],
			selectedClipId: "clip-1",
			speed: 0.5,
		});

		expect(result).toEqual({
			clipRegions: [{ id: "clip-1", startMs: 0, endMs: 10_000, speed: 0.5 }],
			zoomRegions: [],
			audioRegions: [],
			annotationRegions: [],
			speedRegions: [],
			captionCues: [],
		});
	});

	it("shortens an isolated clip when speeding it up", () => {
		const result = planClipSpeedChange({
			clipRegions: [{ id: "clip-1", startMs: 0, endMs: 6_000, speed: 1 }],
			zoomRegions: [],
			audioRegions: [],
			annotationRegions: [],
			speedRegions: [],
			captions: [],
			selectedClipId: "clip-1",
			speed: 2,
		});

		expect(result).toEqual({
			clipRegions: [{ id: "clip-1", startMs: 0, endMs: 3_000, speed: 2 }],
			zoomRegions: [],
			audioRegions: [],
			annotationRegions: [],
			speedRegions: [],
			captionCues: [],
		});
	});

	it("treats invalid stored clip speed as 1x", () => {
		const result = planClipSpeedChange({
			clipRegions: [{ id: "clip-1", startMs: 0, endMs: 4_000, speed: Number.NaN }],
			zoomRegions: [],
			audioRegions: [],
			annotationRegions: [],
			speedRegions: [],
			captions: [],
			selectedClipId: "clip-1",
			speed: 0.5,
		});

		expect(result).toEqual({
			clipRegions: [{ id: "clip-1", startMs: 0, endMs: 8_000, speed: 0.5 }],
			zoomRegions: [],
			audioRegions: [],
			annotationRegions: [],
			speedRegions: [],
			captionCues: [],
		});
	});

	it("blocks slow speed changes that would overlap the next clip", () => {
		const result = planClipSpeedChange({
			clipRegions: [
				{ id: "clip-1", startMs: 0, endMs: 5_000, speed: 1 },
				{ id: "clip-2", startMs: 5_000, endMs: 10_000, speed: 1 },
			],
			zoomRegions: [],
			audioRegions: [],
			annotationRegions: [],
			speedRegions: [],
			captions: [],
			selectedClipId: "clip-1",
			speed: 0.5,
		}) as BlockedClipSpeedChange;

		expect(result.blockedReason).toBe("clip-overlap");
	});

	it("scales zoom regions inside the changed clip", () => {
		const result = planClipSpeedChange({
			clipRegions: [{ id: "clip-1", startMs: 1_000, endMs: 5_000, speed: 1 }],
			zoomRegions: [
				{
					id: "zoom-1",
					startMs: 2_000,
					endMs: 3_000,
					depth: 2,
					focus: { cx: 0.5, cy: 0.5 },
				},
			],
			audioRegions: [],
			annotationRegions: [],
			speedRegions: [],
			captions: [],
			selectedClipId: "clip-1",
			speed: 0.5,
		});

		expect(result).toEqual({
			clipRegions: [{ id: "clip-1", startMs: 1_000, endMs: 9_000, speed: 0.5 }],
			zoomRegions: [
				{
					id: "zoom-1",
					startMs: 3_000,
					endMs: 5_000,
					depth: 2,
					focus: { cx: 0.5, cy: 0.5 },
				},
			],
			audioRegions: [],
			annotationRegions: [],
			speedRegions: [],
			captionCues: [],
		});
	});

	it("does not scale zoom regions that start outside the changed clip", () => {
		const result = planClipSpeedChange({
			clipRegions: [{ id: "clip-1", startMs: 2_000, endMs: 6_000, speed: 1 }],
			zoomRegions: [
				{
					id: "zoom-before",
					startMs: 1_000,
					endMs: 1_500,
					depth: 2,
					focus: { cx: 0.5, cy: 0.5 },
				},
				{
					id: "zoom-after",
					startMs: 6_000,
					endMs: 6_500,
					depth: 2,
					focus: { cx: 0.5, cy: 0.5 },
				},
			],
			audioRegions: [],
			annotationRegions: [],
			speedRegions: [],
			captions: [],
			selectedClipId: "clip-1",
			speed: 0.5,
		});

		expect(result).toEqual({
			clipRegions: [{ id: "clip-1", startMs: 2_000, endMs: 10_000, speed: 0.5 }],
			zoomRegions: [
				{
					id: "zoom-before",
					startMs: 1_000,
					endMs: 1_500,
					depth: 2,
					focus: { cx: 0.5, cy: 0.5 },
				},
				{
					id: "zoom-after",
					startMs: 6_000,
					endMs: 6_500,
					depth: 2,
					focus: { cx: 0.5, cy: 0.5 },
				},
			],
			audioRegions: [],
			annotationRegions: [],
			speedRegions: [],
			captionCues: [],
		});
	});

	it("blocks speed changes that would make scaled zooms overlap unchanged zooms", () => {
		const result = planClipSpeedChange({
			clipRegions: [{ id: "clip-1", startMs: 0, endMs: 5_000, speed: 1 }],
			zoomRegions: [
				{
					id: "zoom-1",
					startMs: 2_000,
					endMs: 3_000,
					depth: 2,
					focus: { cx: 0.5, cy: 0.5 },
				},
				{
					id: "zoom-2",
					startMs: 5_500,
					endMs: 6_500,
					depth: 3,
					focus: { cx: 0.5, cy: 0.5 },
				},
			],
			audioRegions: [],
			annotationRegions: [],
			speedRegions: [],
			captions: [],
			selectedClipId: "clip-1",
			speed: 0.5,
		}) as BlockedClipSpeedChange;

		expect(result.blockedReason).toBe("zoom-overlap");
	});

	it("retimes caption cues inside the clip and rescales their word timings", () => {
		const result = planClipSpeedChange({
			clipRegions: [{ id: "clip-1", startMs: 0, endMs: 4_000, speed: 1 }],
			zoomRegions: [],
			audioRegions: [],
			annotationRegions: [],
			speedRegions: [],
			captions: [
				{
					id: "cue-inside",
					startMs: 1_000,
					endMs: 3_000,
					text: "hello world",
					words: [
						{ text: "hello", startMs: 1_000, endMs: 2_000 },
						{ text: "world", startMs: 2_000, endMs: 3_000, leadingSpace: true },
					],
				},
				{ id: "cue-after", startMs: 5_000, endMs: 6_000, text: "later" },
			],
			selectedClipId: "clip-1",
			speed: 0.5,
		});

		expect((result as { captionCues: unknown[] }).captionCues).toEqual([
			{
				id: "cue-inside",
				startMs: 2_000,
				endMs: 6_000,
				text: "hello world",
				words: [
					{ text: "hello", startMs: 2_000, endMs: 4_000 },
					{ text: "world", startMs: 4_000, endMs: 6_000, leadingSpace: true },
				],
			},
			{ id: "cue-after", startMs: 5_000, endMs: 6_000, text: "later" },
		]);
	});

	it("clamps a caption that straddles the old clip end when speeding up", () => {
		const result = planClipSpeedChange({
			clipRegions: [{ id: "clip-1", startMs: 0, endMs: 6_000, speed: 1 }],
			zoomRegions: [],
			audioRegions: [],
			annotationRegions: [],
			speedRegions: [],
			captions: [{ id: "cue-straddle", startMs: 5_000, endMs: 7_000, text: "tail" }],
			selectedClipId: "clip-1",
			speed: 2,
		});

		expect((result as { captionCues: unknown[] }).captionCues).toEqual([
			{
				id: "cue-straddle",
				startMs: 2_500,
				endMs: 3_000,
				text: "tail",
			},
		]);
	});

	it("remaps audio, annotation, and speed regions that start inside the clip", () => {
		const audioRegion: AudioRegion = {
			id: "audio-1",
			startMs: 1_000,
			endMs: 2_000,
			audioPath: "music.mp3",
			volume: 0.8,
			normalize: false,
			trackIndex: 0,
		};
		const annotationRegion: AnnotationRegion = {
			id: "annotation-1",
			startMs: 500,
			endMs: 1_500,
			type: "text",
			content: "note",
			position: { x: 10, y: 10 },
			size: { width: 20, height: 10 },
			style: {
				fontFamily: "Arial",
				fontSize: 24,
				color: "#ffffff",
				backgroundColor: "transparent",
				fontWeight: "normal",
				fontStyle: "normal",
				textDecoration: "none",
				textAlign: "left",
			},
			zIndex: 1,
			trackIndex: 0,
		};
		const speedRegion: SpeedRegion = {
			id: "speed-1",
			startMs: 2_000,
			endMs: 3_000,
			speed: 1.5,
		};
		const outsideAudio: AudioRegion = {
			id: "audio-outside",
			startMs: 8_000,
			endMs: 9_000,
			audioPath: "sfx.mp3",
			volume: 1,
			normalize: false,
			trackIndex: 0,
		};

		const result = planClipSpeedChange({
			clipRegions: [{ id: "clip-1", startMs: 0, endMs: 4_000, speed: 1 }],
			zoomRegions: [],
			audioRegions: [audioRegion, outsideAudio],
			annotationRegions: [annotationRegion],
			speedRegions: [speedRegion],
			captions: [],
			selectedClipId: "clip-1",
			speed: 0.5,
		}) as { audioRegions: AudioRegion[]; annotationRegions: AnnotationRegion[]; speedRegions: SpeedRegion[] };

		expect(result.audioRegions).toEqual([
			{ ...audioRegion, startMs: 2_000, endMs: 4_000 },
			outsideAudio,
		]);
		expect(result.annotationRegions).toEqual([
			{ ...annotationRegion, startMs: 1_000, endMs: 3_000 },
		]);
		expect(result.speedRegions).toEqual([{ ...speedRegion, startMs: 4_000, endMs: 6_000 }]);
	});

	it("leaves regions that start before the clip untouched", () => {
		const audioRegion: AudioRegion = {
			id: "audio-straddle",
			startMs: 3_500,
			endMs: 4_500,
			audioPath: "sfx.mp3",
			volume: 1,
			normalize: false,
			trackIndex: 0,
		};

		const result = planClipSpeedChange({
			clipRegions: [{ id: "clip-1", startMs: 4_000, endMs: 8_000, speed: 1 }],
			zoomRegions: [],
			audioRegions: [audioRegion],
			annotationRegions: [],
			speedRegions: [],
			captions: [],
			selectedClipId: "clip-1",
			speed: 0.5,
		}) as { audioRegions: AudioRegion[] };

		expect(result.audioRegions).toEqual([audioRegion]);
	});
});
