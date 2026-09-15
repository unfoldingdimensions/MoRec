import { describe, expect, it } from "vitest";

import { buildCaptionTextFromWords, parseWhisperJsonWords } from "./parser";

describe("parseWhisperJsonWords", () => {
	it("splits tokens into space-separated words with timing", () => {
		const words = parseWhisperJsonWords([
			{ text: " Hello", offsets: { from: 0, to: 400 } },
			{ text: " world", offsets: { from: 400, to: 900 } },
		]);

		expect(words).toEqual([
			{ text: "Hello", startMs: 0, endMs: 400 },
			{ text: "world", startMs: 400, endMs: 900, leadingSpace: true },
		]);
		expect(buildCaptionTextFromWords(words)).toBe("Hello world");
	});

	it("skips malformed tokens instead of dropping all word timing", () => {
		const words = parseWhisperJsonWords([
			{ text: " Keep", offsets: { from: 0, to: 300 } },
			// whisper.cpp can emit zero-duration special/hallucination tokens.
			{ text: "[inaudible]", offsets: { from: 300, to: 300 } },
			{ text: " going", offsets: { from: 300, to: 700 } },
		]);

		expect(words.map((word) => word.text)).toEqual(["Keep", "going"]);
	});

	it("skips tokens without offsets without discarding the rest", () => {
		const words = parseWhisperJsonWords([
			{ text: " A", offsets: { from: 0, to: 100 } },
			{ text: " B" },
			{ text: " C", offsets: { from: 200, to: 400 } },
		]);

		expect(words.map((word) => word.text)).toEqual(["A", "C"]);
	});

	it("merges consecutive sub-word parts into one word", () => {
		const words = parseWhisperJsonWords([
			{ text: " won", offsets: { from: 0, to: 200 } },
			{ text: "der", offsets: { from: 200, to: 350 } },
			{ text: "ful", offsets: { from: 350, to: 500 } },
		]);

		expect(words).toEqual([{ text: "wonderful", startMs: 0, endMs: 500 }]);
	});

	it("returns an empty list for non-array input", () => {
		expect(parseWhisperJsonWords(null)).toEqual([]);
		expect(parseWhisperJsonWords("nope")).toEqual([]);
	});
});
