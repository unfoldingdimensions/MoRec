import { describe, expect, it } from "vitest";
import { buildActiveCaptionLayout, flattenCaptionWords } from "./captionLayout";
import { type CaptionCue, DEFAULT_AUTO_CAPTION_SETTINGS } from "./types";

describe("flattenCaptionWords", () => {
	it("forces a break at every cue boundary so each phrase shows on its own", () => {
		const cues: CaptionCue[] = [
			{
				id: "a",
				startMs: 0,
				endMs: 1_000,
				text: "hello world",
				words: [
					{ text: "hello", startMs: 0, endMs: 500 },
					{ text: "world", startMs: 500, endMs: 1_000, leadingSpace: true },
				],
			},
			{
				// back-to-back with cue "a" (no gap) — would previously be re-packed by width
				id: "b",
				startMs: 1_000,
				endMs: 2_000,
				text: "next one",
				words: [
					{ text: "next", startMs: 1_000, endMs: 1_500 },
					{ text: "one", startMs: 1_500, endMs: 2_000, leadingSpace: true },
				],
			},
		];

		const flattened = flattenCaptionWords(cues);
		const firstWordOfSecondCue = flattened.find(
			(word) => word.cueId === "b" && word.cueWordIndex === 0,
		);

		expect(firstWordOfSecondCue?.forcedBreakBefore).toBe(true);
		expect(firstWordOfSecondCue?.leadingSpace).toBe(false);
		// the very first word of the first cue never forces a break
		expect(flattened[0].forcedBreakBefore).toBe(false);
	});
});

describe("buildActiveCaptionLayout exit fade", () => {
	it("fades a cue out before its page ends even when another cue follows within the gap window", () => {
		const cues: CaptionCue[] = [
			{
				id: "a",
				startMs: 0,
				endMs: 3_000,
				text: "aa bb",
				words: [
					{ text: "aa", startMs: 0, endMs: 1_500 },
					{ text: "bb", startMs: 1_500, endMs: 3_000, leadingSpace: true },
				],
			},
			{
				// follows within the 500ms gap-break window, so willDisappear is false
				id: "b",
				startMs: 3_100,
				endMs: 4_000,
				text: "cc",
				words: [{ text: "cc", startMs: 3_100, endMs: 4_000 }],
			},
		];
		const build = (timeMs: number) =>
			buildActiveCaptionLayout({
				cues,
				timeMs,
				settings: { ...DEFAULT_AUTO_CAPTION_SETTINGS, animationStyle: "pop" },
				maxWidthPx: 500,
				measureText: (text) => text.length * 10,
			});

		const midCue = build(1_500);
		// page 0's end is stitched to the next page's start (3100), so sample the
		// exit window just before that swap
		const nearEnd = build(3_050);

		expect(midCue).not.toBeNull();
		expect(nearEnd).not.toBeNull();
		// mid-cue opacity is at its full style level; 50ms before the page end the
		// exit fade must have pulled it well below that floor (was previously
		// pinned at the floor and snapped off on unmount)
		expect(nearEnd!.opacity).toBeLessThan(midCue!.opacity * 0.6);
	});

	it("keeps constant opacity for the none animation style", () => {
		const cues: CaptionCue[] = [
			{
				id: "a",
				startMs: 0,
				endMs: 3_000,
				text: "aa bb",
				words: [
					{ text: "aa", startMs: 0, endMs: 1_500 },
					{ text: "bb", startMs: 1_500, endMs: 3_000, leadingSpace: true },
				],
			},
		];
		const nearEnd = buildActiveCaptionLayout({
			cues,
			timeMs: 2_950,
			settings: { ...DEFAULT_AUTO_CAPTION_SETTINGS, animationStyle: "none" },
			maxWidthPx: 500,
			measureText: (text) => text.length * 10,
		});

		expect(nearEnd!.opacity).toBe(1);
	});
});
