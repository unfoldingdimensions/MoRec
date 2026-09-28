import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	addRecordingMark,
	beginRecordingCapture,
	consumeRecordingMarksForPath,
	getRecordingMarks,
	getRecordingTargetPath,
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

		expect(consumeRecordingMarksForPath("/recordings/recording-7.mp4")).toEqual([
			3000,
			9000,
		]);
		expect(getRecordingMarks()).toEqual([]);
		// Consumed marks are not handed out twice.
		expect(consumeRecordingMarksForPath("/recordings/recording-7.mp4")).toBeNull();
	});

	it("attaches to an auto-recording path when the target is unknown (browser capture)", () => {
		beginRecordingCapture(null);
		addRecordingMark(1500);

		// An unrelated import must not inherit stale marks.
		expect(consumeRecordingMarksForPath("/media/imported-holiday.mp4")).toBeNull();
		expect(consumeRecordingMarksForPath("/recordings/recording-9.mp4")).toEqual([1500]);
	});
});
