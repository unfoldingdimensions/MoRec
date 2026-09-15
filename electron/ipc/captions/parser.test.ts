import { describe, expect, it } from "vitest";

import { buildCaptionTextFromWords, parseSrtCues, parseSrtTimestamp, parseWhisperJsonWords } from "./parser";

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

describe("parseSrtTimestamp", () => {
	it("accepts standard two-digit-hour timestamps", () => {
		expect(parseSrtTimestamp("01:02:03,004")).toBe(3_723_004);
	});

	it("accepts single-digit-hour timestamps written by other tools", () => {
		expect(parseSrtTimestamp("0:00:01,000")).toBe(1_000);
	});

	it("rejects malformed timestamps", () => {
		expect(parseSrtTimestamp("nope")).toBeNull();
		expect(parseSrtTimestamp("1:2:3,4")).toBeNull();
	});
});

describe("parseSrtCues", () => {
	it("parses blocks with single-digit hour timestamps", () => {
		const cues = parseSrtCues(["1", "0:00:00,500 --> 0:00:02,000", "Hello there", ""].join("\n"));

		expect(cues).toEqual([{ id: "caption-1", startMs: 500, endMs: 2000, text: "Hello there" }]);
	});

	it("keeps multi-line cue text", () => {
		const cues = parseSrtCues(
			["1", "00:00:01,000 --> 00:00:03,500", "line one", "line two", ""].join("\r\n"),
		);

		expect(cues).toEqual([
			{ id: "caption-1", startMs: 1000, endMs: 3500, text: "line one\nline two" },
		]);
	});
});
