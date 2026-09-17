import { beforeEach, describe, expect, it, vi } from "vitest";
import { CURSOR_TELEMETRY_VERSION } from "../constants";

const { writeFile, rm } = vi.hoisted(() => ({
	writeFile: vi.fn(),
	rm: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({
	default: {
		writeFile,
		rm,
	},
}));

vi.mock("electron", () => ({
	app: {
		getPath: vi.fn(() => "/tmp"),
	},
}));

vi.mock("../utils", () => ({
	getTelemetryPathForVideo: vi.fn(() => "/tmp/recording.cursor.json"),
	getScreen: vi.fn(() => ({
		getCursorScreenPoint: () => ({ x: 0, y: 0 }),
		getPrimaryDisplay: () => ({ scaleFactor: 1 }),
		getDisplayNearestPoint: () => ({ bounds: { x: 0, y: 0, width: 1, height: 1 } }),
		getAllDisplays: () => [],
	})),
}));

import { activeCursorSamples, setActiveCursorSamples, setCursorCaptureStartTimeMs } from "../state";
import {
	findDisplayForPhysicalPoint,
	getCursorCaptureElapsedMs,
	normalizeCursorPointToWindowRegion,
	normalizeCursorTelemetrySamples,
	pauseCursorCapture,
	pauseCursorCaptureAtBoundary,
	pushCursorSample,
	resetCursorCaptureClock,
	resumeCursorCapture,
	writeCursorTelemetry,
} from "./telemetry";

describe("cursor telemetry pause clock", () => {
	beforeEach(() => {
		writeFile.mockReset();
		rm.mockReset();
		setCursorCaptureStartTimeMs(1_000);
		setActiveCursorSamples([]);
		resetCursorCaptureClock();
	});

	it("subtracts paused time from elapsed cursor timestamps", () => {
		expect(getCursorCaptureElapsedMs(1_120)).toBe(120);

		pauseCursorCapture(1_200);
		expect(getCursorCaptureElapsedMs(1_450)).toBe(200);

		resumeCursorCapture(1_700);
		expect(getCursorCaptureElapsedMs(1_900)).toBe(400);
	});

	it("ignores duplicate pause or resume transitions", () => {
		pauseCursorCapture(1_150);
		pauseCursorCapture(1_250);
		resumeCursorCapture(1_500);
		resumeCursorCapture(1_650);

		expect(getCursorCaptureElapsedMs(1_900)).toBe(550);
	});

	it("drops cursor samples captured after the renderer pause boundary", () => {
		pushCursorSample(0.1, 0.1, 120, "move");
		pushCursorSample(0.2, 0.2, 205, "move");
		pushCursorSample(0.3, 0.3, 260, "move");

		pauseCursorCaptureAtBoundary(1_200);

		expect(getCursorCaptureElapsedMs(1_500)).toBe(200);
		expect(activeCursorSamples.map((sample) => sample.timeMs)).toEqual([120]);

		resumeCursorCapture(1_700);
		expect(getCursorCaptureElapsedMs(1_900)).toBe(400);
	});

	it("normalizes cursor telemetry samples before persisting them", async () => {
		const samples = normalizeCursorTelemetrySamples([
			{ timeMs: 30, cx: 2, cy: -1, interactionType: "click", cursorType: "pointer" },
			{ timeMs: -10, cx: Number.NaN, cy: 0.2, interactionType: "drag", cursorType: "ibeam" },
			{ timeMs: 10, cx: 0.25, cy: 0.75, interactionType: "move", cursorType: "text" },
		]);

		expect(samples).toEqual([
			{ timeMs: 0, cx: 0.5, cy: 0.2, interactionType: undefined, cursorType: undefined },
			{ timeMs: 10, cx: 0.25, cy: 0.75, interactionType: "move", cursorType: "text" },
			{ timeMs: 30, cx: 1, cy: 0, interactionType: "click", cursorType: "pointer" },
		]);

		await writeCursorTelemetry("/tmp/recording.mp4", samples);

		expect(writeFile).toHaveBeenCalledWith(
			"/tmp/recording.cursor.json",
			JSON.stringify(
				{
					version: CURSOR_TELEMETRY_VERSION,
					samples,
				},
				null,
				2,
			),
			"utf-8",
		);
		expect(rm).not.toHaveBeenCalled();
	});

	it("removes the sidecar when saving an empty cursor telemetry payload", async () => {
		await writeCursorTelemetry("/tmp/recording.mp4", []);

		expect(rm).toHaveBeenCalledWith("/tmp/recording.cursor.json", { force: true });
		expect(writeFile).not.toHaveBeenCalled();
	});
});

describe("physical-space window normalization", () => {
	const displays = [
		{
			id: 1,
			bounds: { x: 0, y: 0, width: 2048, height: 1152 },
			scaleFactor: 1.25,
		},
		{
			id: 2,
			bounds: { x: 2048, y: 0, width: 1920, height: 1080 },
			scaleFactor: 1,
		},
	];

	it("matches a physical point to the display whose scaled rect contains it", () => {
		expect(findDisplayForPhysicalPoint(displays, 100, 100)?.id).toBe(1);
		// 2048 DIP * 1.25 = 2560 physical pixels is display 2's origin.
		expect(findDisplayForPhysicalPoint(displays, 2600, 50)?.id).toBe(2);
	});

	it("assigns a point on a shared edge to the later display, not null", () => {
		// Display 2's physical rect starts at 2560; the edge belongs to it.
		expect(findDisplayForPhysicalPoint(displays, 2560, 576)?.id).toBe(2);
	});

	it("falls back to the nearest display instead of returning null outside all rects", () => {
		expect(findDisplayForPhysicalPoint(displays, -50, -50)?.id).toBe(1);
		expect(findDisplayForPhysicalPoint(displays, 4600, 20)?.id).toBe(2);
	});

	it("normalizes a physical window rect through the owning display scale factor", () => {
		// Window occupying the left half of the 125% display: 1280 DIP wide
		// => 1600 physical pixels wide.
		const bounds = { x: 0, y: 0, width: 1600, height: 1440 };

		expect(
			normalizeCursorPointToWindowRegion({ x: 800, y: 720 }, bounds, displays),
		).toEqual({ cx: 0.625, cy: 0.625 });
	});

	it("maps a cursor near the window origin to the frame origin, not an offset", () => {
		// Regression for the double-scaling bug: a cursor at the window's
		// top-left must normalize to (0, 0) regardless of scale factor.
		const bounds = { x: 2560, y: 0, width: 960, height: 540 };
		expect(
			normalizeCursorPointToWindowRegion({ x: 2048, y: 0 }, bounds, displays),
		).toEqual({ cx: 0, cy: 0 });
	});

	it("treats bounds as unscaled when no display matches", () => {
		const bounds = { x: 0, y: 0, width: 800, height: 600 };
		expect(
			normalizeCursorPointToWindowRegion({ x: 400, y: 300 }, bounds, []),
		).toEqual({ cx: 0.5, cy: 0.5 });
	});
});
