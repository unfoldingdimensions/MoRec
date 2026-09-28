import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	addRecordingMark,
	addRecordingSegmentFile,
	beginRecordingCapture,
	consumeRecordingMarksForPath,
	getPrimarySegmentPath,
	getRecordingMarks,
	getRecordingSegmentFiles,
	getRecordingTargetPath,
	isRecordingSegmented,
	resetRecordingMarks,
} from "./marks";

// ../utils (via isAutoRecordingPath) reads electron app paths at import time.
vi.mock("electron", () => ({
	app: {
		isPackaged: false,
		getAppPath: () => process.cwd(),
		getPath: (name: string) => (name === "userData" ? "/morec-test-userdata" : process.cwd()),
	},
}));

describe("recording marks state", () => {
	beforeEach(() => {
		beginRecordingCapture(null);
	});

	it("appends marks ascending and returns a copy", () => {
		expect(addRecordingMark(5000)).toEqual([5000]);
		expect(addRecordingMark(12_000)).toEqual([5000, 12_000]);
		expect(getRecordingMarks()).toEqual([5000, 12_000]);

		const marks = getRecordingMarks();
		marks.push(99_999);
		expect(getRecordingMarks()).toEqual([5000, 12_000]);
	});

	it("ignores a 0:00 mark and double-taps within 500 ms", () => {
		expect(addRecordingMark(0)).toEqual([]);
		expect(addRecordingMark(100)).toEqual([]);
		addRecordingMark(10_000);
		expect(addRecordingMark(10_300)).toEqual([10_000]);
		expect(addRecordingMark(10_500)).toEqual([10_000, 10_500]);
	});

	it("records and reports the target path", () => {
		beginRecordingCapture("C:\\rec\\recording-1.mp4");
		expect(getRecordingTargetPath()).toContain("recording-1.mp4");

		resetRecordingMarks();
		expect(getRecordingMarks()).toEqual([]);
		expect(getRecordingTargetPath()).toContain("recording-1.mp4");
	});

	it("consumes marks on an exact target-path match and clears them", () => {
		beginRecordingCapture("/recordings/recording-7.mp4");
		addRecordingMark(3000);
		addRecordingMark(9000);

		// Mismatched path keeps the marks pending.
		expect(consumeRecordingMarksForPath("/recordings/other.mp4")).toBeNull();
		expect(getRecordingMarks()).toHaveLength(2);

		expect(consumeRecordingMarksForPath("/recordings/recording-7.mp4")).toEqual({
			marksMs: [3000, 9000],
			segmentFiles: [],
		});
		expect(getRecordingMarks()).toEqual([]);
		// Consumed marks are not handed out twice.
		expect(consumeRecordingMarksForPath("/recordings/recording-7.mp4")).toBeNull();
	});

	it("attaches to an auto-recording path when the target is unknown (browser capture)", () => {
		beginRecordingCapture(null);
		addRecordingMark(1500);

		// An unrelated import must not inherit stale marks.
		expect(consumeRecordingMarksForPath("/media/imported-holiday.mp4")).toBeNull();
		expect(consumeRecordingMarksForPath("/recordings/recording-9.mp4")).toEqual({
			marksMs: [1500],
			segmentFiles: [],
		});
	});

	it("tracks segment files in order and reports the primary (first) path", () => {
		beginRecordingCapture("/recordings/recording-1.mp4");
		expect(isRecordingSegmented()).toBe(false);

		addRecordingSegmentFile("/recordings/recording-1.mp4");
		addRecordingSegmentFile("/recordings/recording-2.mp4");
		expect(getRecordingSegmentFiles()).toEqual([
			"/recordings/recording-1.mp4",
			"/recordings/recording-2.mp4",
		]);
		expect(isRecordingSegmented()).toBe(true);
		expect(getPrimarySegmentPath("/recordings/recording-2.mp4")).toBe(
			"/recordings/recording-1.mp4",
		);

		// No segments engaged: the caller's path passes through.
		resetRecordingMarks();
		expect(getPrimarySegmentPath("/recordings/only.mp4")).toBe("/recordings/only.mp4");
	});

	it("consume returns marks + segments together and clears both", () => {
		beginRecordingCapture("/recordings/recording-1.mp4");
		addRecordingSegmentFile("/recordings/recording-1.mp4");
		addRecordingSegmentFile("/recordings/recording-2.mp4");
		addRecordingMark(5000);

		const consumed = consumeRecordingMarksForPath("/recordings/recording-1.mp4");
		expect(consumed).toEqual({
			marksMs: [5000],
			segmentFiles: ["/recordings/recording-1.mp4", "/recordings/recording-2.mp4"],
		});
		expect(getRecordingSegmentFiles()).toEqual([]);
		expect(getRecordingMarks()).toEqual([]);
		expect(isRecordingSegmented()).toBe(false);
	});

	it("segment consumption anchors on the primary path only", () => {
		beginRecordingCapture("/recordings/recording-1.mp4");
		addRecordingSegmentFile("/recordings/recording-1.mp4");
		addRecordingSegmentFile("/recordings/recording-2.mp4");

		// The last segment's path must not consume the session state.
		expect(consumeRecordingMarksForPath("/recordings/recording-2.mp4")).toBeNull();
		expect(getRecordingSegmentFiles()).toHaveLength(2);
	});

	it("beginRecordingCapture preserves segments (rollover respawn re-enters start)", () => {
		resetRecordingMarks();
		beginRecordingCapture("/recordings/recording-1.mp4");
		addRecordingSegmentFile("/recordings/recording-1.mp4");

		// Rollover respawn calls the start path with the next segment target.
		beginRecordingCapture("/recordings/recording-2.mp4");
		expect(getRecordingSegmentFiles()).toEqual(["/recordings/recording-1.mp4"]);
		expect(getRecordingMarks()).toEqual([]);

		// A genuinely new recording clears them.
		resetRecordingMarks();
		expect(getRecordingSegmentFiles()).toEqual([]);
	});
});
