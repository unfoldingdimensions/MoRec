import { describe, expect, it } from "vitest";

import {
	type CaptionEditTarget,
	normalizeCaptionEditText,
	updateCaptionCuesForEditedTarget,
} from "./captionEditing";
import { buildActiveCaptionLayout } from "./captionLayout";
import { type CaptionCue, DEFAULT_AUTO_CAPTION_SETTINGS } from "./types";

const visibleTarget: CaptionEditTarget = {
	id: "visible-page",
	startMs: 1_000,
	endMs: 2_400,
	text: "Hello Hello 你们好啊",
	words: [
		{
			cueId: "a",
			cueWordIndex: 0,
			startMs: 1_000,
			endMs: 1_500,
			text: "Hello",
			leadingSpace: false,
		},
		{
			cueId: "a",
			cueWordIndex: 1,
			startMs: 1_500,
			endMs: 2_000,
			text: "Hello",
			leadingSpace: true,
		},
		{
			cueId: "b",
			cueWordIndex: 0,
			startMs: 2_000,
			endMs: 2_400,
			text: "你们好啊",
			leadingSpace: true,
		},
	],
};

describe("captionEditing", () => {
	it("normalizes edited caption text", () => {
		expect(normalizeCaptionEditText("  hello \n edited\tcaption  ")).toBe(
			"hello edited caption",
		);
		expect(normalizeCaptionEditText(" \n\t ")).toBe("");
	});

	it("keeps text-only captions text-only after editing", () => {
		const updated = updateCaptionCuesForEditedTarget(
			[
				{ id: "a", startMs: 1_000, endMs: 2_000, text: "Hello Hello" },
				{ id: "b", startMs: 2_000, endMs: 3_000, text: "你们好啊 这个是我的屏幕" },
			],
			visibleTarget,
			"Hi 大家好",
		);

		expect(updated.map((caption) => caption.text)).toEqual(["Hi", "大家好 这个是我的屏幕"]);
		expect(updated.every((caption) => caption.words === undefined)).toBe(true);

		const layout = buildActiveCaptionLayout({
			cues: updated,
			timeMs: 1_500,
			settings: DEFAULT_AUTO_CAPTION_SETTINGS,
			maxWidthPx: 500,
			measureText: (text) => text.length * 10,
		});
		expect(layout?.hasWordTimings).toBe(false);
	});

	it("preserves cue identity and timing when editing captions with word timings", () => {
		const cues: CaptionCue[] = [
			{
				id: "a",
				startMs: 1_000,
				endMs: 2_000,
				text: "Hello Hello",
				words: [
					{ text: "Hello", startMs: 1_000, endMs: 1_500 },
					{ text: "Hello", startMs: 1_500, endMs: 2_000, leadingSpace: true },
				],
			},
			{
				id: "b",
				startMs: 2_000,
				endMs: 3_000,
				text: "你们好啊 这个是我的屏幕",
				words: [
					{ text: "你们好啊", startMs: 2_000, endMs: 2_400 },
					{ text: "这个是我的屏幕", startMs: 2_400, endMs: 3_000, leadingSpace: true },
				],
			},
		];

		const updated = updateCaptionCuesForEditedTarget(cues, visibleTarget, "Hi 大家好");

		expect(updated.map((caption) => [caption.id, caption.startMs, caption.endMs])).toEqual([
			["a", 1_000, 2_000],
			["b", 2_000, 3_000],
		]);
		expect(updated[0].words).toEqual([{ text: "Hi", startMs: 1_000, endMs: 2_000 }]);
		expect(updated[1].words).toEqual([
			{ text: "大家好", startMs: 2_000, endMs: 2_400 },
			{ text: "这个是我的屏幕", startMs: 2_400, endMs: 3_000, leadingSpace: true },
		]);
	});

	it("does not update captions when edited text is blank", () => {
		const cues: CaptionCue[] = [{ id: "a", startMs: 1_000, endMs: 2_000, text: "Hello Hello" }];

		expect(updateCaptionCuesForEditedTarget(cues, visibleTarget, " \n\t ")).toBe(cues);
	});

	it("keeps sound-effect style captions editable when word entries are blank", () => {
		const cues: CaptionCue[] = [
			{
				id: "sound-effect",
				startMs: 1_000,
				endMs: 2_000,
				text: "clears throat",
				words: [{ text: "", startMs: 1_000, endMs: 2_000 }],
			},
		];

		const layout = buildActiveCaptionLayout({
			cues,
			timeMs: 1_500,
			settings: DEFAULT_AUTO_CAPTION_SETTINGS,
			maxWidthPx: 500,
			measureText: (text) => text.length * 10,
		});

		expect(layout?.editTarget.text).toBe("clears throat");

		const updated = updateCaptionCuesForEditedTarget(cues, layout!.editTarget, "coughs");

		expect(updated[0].text).toBe("coughs");
		expect(updated[0].words).toEqual([{ text: "coughs", startMs: 1_000, endMs: 2_000 }]);
	});

	it("drops edited cues that receive no tokens instead of leaving empty text", () => {
		// Three fully-targeted cues; replacement text has one token, which is
		// distributed to the largest segment. The other two cues would previously
		// be left with empty text and vanish on the next save/load.
		const cues: CaptionCue[] = [
			{
				id: "a",
				startMs: 1_000,
				endMs: 2_000,
				text: "one two",
				words: [
					{ text: "one", startMs: 1_000, endMs: 1_500 },
					{ text: "two", startMs: 1_500, endMs: 2_000, leadingSpace: true },
				],
			},
			{
				id: "b",
				startMs: 3_000,
				endMs: 4_000,
				text: "three",
				words: [{ text: "three", startMs: 3_000, endMs: 4_000 }],
			},
			{
				id: "c",
				startMs: 5_000,
				endMs: 6_500,
				text: "four five",
				words: [
					{ text: "four", startMs: 5_000, endMs: 5_750 },
					{ text: "five", startMs: 5_750, endMs: 6_500, leadingSpace: true },
				],
			},
		];
		const target: CaptionEditTarget = {
			id: "page",
			startMs: 1_000,
			endMs: 6_500,
			text: "one two three four five",
			words: [
				{ cueId: "a", cueWordIndex: 0, startMs: 1_000, endMs: 1_500, text: "one", leadingSpace: false },
				{ cueId: "a", cueWordIndex: 1, startMs: 1_500, endMs: 2_000, text: "two", leadingSpace: true },
				{ cueId: "b", cueWordIndex: 0, startMs: 3_000, endMs: 4_000, text: "three", leadingSpace: true },
				{ cueId: "c", cueWordIndex: 0, startMs: 5_000, endMs: 5_750, text: "four", leadingSpace: true },
				{ cueId: "c", cueWordIndex: 1, startMs: 5_750, endMs: 6_500, text: "five", leadingSpace: true },
			],
		};

		const updated = updateCaptionCuesForEditedTarget(cues, target, "replacement");

		expect(updated.map((caption) => caption.id)).toEqual(["c"]);
		expect(updated[0].text).toBe("replacement");
		expect(updated[0].words).toEqual([
			{ text: "replacement", startMs: 5_000, endMs: 6_500 },
		]);
	});
});
