import { describe, expect, it } from "vitest";
import {
	formatChaptersText,
	parseChaptersText,
} from "./youtubeChapters";

describe("formatChaptersText", () => {
	it("renders m:ss Title lines starting at 0:00", () => {
		expect(
			formatChaptersText([
				{ startMs: 0, title: "Intro" },
				{ startMs: 65_000, title: "Deep dive" },
			]),
		).toBe("0:00 Intro\n1:05 Deep dive");
	});

	it("uses h:mm:ss once past an hour", () => {
		expect(
			formatChaptersText([
				{ startMs: 0, title: "Start" },
				{ startMs: 3_725_000, title: "Later" },
			]),
		).toBe("0:00 Start\n1:02:05 Later");
	});

	it("inserts a 0:00 line when the first chapter starts later", () => {
		expect(formatChaptersText([{ startMs: 30_000, title: "Only" }])).toBe(
			"0:00\n0:30 Only",
		);
	});

	it("returns an empty string for no chapters", () => {
		expect(formatChaptersText([])).toBe("");
	});
});

describe("parseChaptersText", () => {
	it("parses m:ss and h:mm:ss lines", () => {
		expect(
			parseChaptersText("0:00 Intro\n2:05 Middle\n1:02:05 Late"),
		).toEqual([
			{ startMs: 0, title: "Intro" },
			{ startMs: 125_000, title: "Middle" },
			{ startMs: 3_725_000, title: "Late" },
		]);
	});

	it("drops lines without a parseable time or an empty title", () => {
		expect(parseChaptersText("hello world\n0:30 \n\n0:45 Valid")).toEqual([
			{ startMs: 45_000, title: "Valid" },
		]);
	});

	it("sorts chapters by timestamp", () => {
		expect(
			parseChaptersText("2:00 Second\n0:00 First"),
		).toEqual([
			{ startMs: 0, title: "First" },
			{ startMs: 120_000, title: "Second" },
		]);
	});

	it("round-trips through format", () => {
		const chapters = [
			{ startMs: 0, title: "Intro" },
			{ startMs: 95_000, title: "Next part" },
		];
		expect(parseChaptersText(formatChaptersText(chapters))).toEqual(chapters);
	});
});
