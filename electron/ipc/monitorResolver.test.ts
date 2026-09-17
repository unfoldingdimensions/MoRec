import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { findMonitorHandleForElectronDisplay } from "./monitorResolver";

/**
 * Tests for the Windows HMONITOR resolver: output parsing, the TTL cache,
 * and failure caching (the async variant replaced a spawnSync that froze the
 * main process on the record-start path).
 */
const execFileMock = vi.hoisted(() => vi.fn());
const spawnSyncMock = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", () => ({
	execFile: execFileMock,
	spawnSync: spawnSyncMock,
}));

const MONITOR_OUTPUT = ["12345|0|0|1920|1080", "6789|1920|0|2560|1440"].join("\n");

describe("monitorResolver", () => {
	beforeEach(() => {
		vi.resetModules();
		execFileMock.mockReset();
		spawnSyncMock.mockReset();
		// The resolver short-circuits to [] off Windows; the units under test here
		// are the PowerShell parsing/caching paths behind that guard.
		vi.spyOn(process, "platform", "get").mockReturnValue("win32");
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("parses monitor handles from PowerShell output", async () => {
		execFileMock.mockImplementation((_cmd, _args, _opts, callback) => {
			callback(null, { stdout: MONITOR_OUTPUT });
		});
		const { getMonitorHandlesAsync } = await import("./monitorResolver");

		expect(await getMonitorHandlesAsync()).toEqual([
			{ handle: 12345, x: 0, y: 0, width: 1920, height: 1080 },
			{ handle: 6789, x: 1920, y: 0, width: 2560, height: 1440 },
		]);
	});

	it("caches results within the TTL and refreshes after it expires", async () => {
		vi.useFakeTimers();
		try {
			execFileMock.mockImplementation((_cmd, _args, _opts, callback) => {
				callback(null, { stdout: MONITOR_OUTPUT });
			});
			const { getMonitorHandlesAsync } = await import("./monitorResolver");

			await getMonitorHandlesAsync();
			await getMonitorHandlesAsync();
			await getMonitorHandlesAsync();
			expect(execFileMock).toHaveBeenCalledTimes(1);

			// Past the 10s TTL the cache refreshes.
			await vi.advanceTimersByTimeAsync(11_000);
			await getMonitorHandlesAsync();
			expect(execFileMock).toHaveBeenCalledTimes(2);
		} finally {
			vi.useRealTimers();
		}
	});

	it("caches failures briefly instead of hammering PowerShell on retries", async () => {
		execFileMock.mockImplementation((_cmd, _args, _opts, callback) => {
			callback(new Error("powershell unavailable"));
		});
		const { getMonitorHandlesAsync } = await import("./monitorResolver");

		expect(await getMonitorHandlesAsync()).toEqual([]);
		expect(await getMonitorHandlesAsync()).toEqual([]);
		expect(execFileMock).toHaveBeenCalledTimes(1);

		// A cached failure expires far sooner than a success so a record start
		// shortly after a transient hiccup still resolves handles.
		vi.useFakeTimers();
		try {
			await vi.advanceTimersByTimeAsync(1_500);
			await getMonitorHandlesAsync();
			expect(execFileMock).toHaveBeenCalledTimes(2);
		} finally {
			vi.useRealTimers();
		}
	});

	it("maps garbage output lines to NaN fields rather than throwing", async () => {
		execFileMock.mockImplementation((_cmd, _args, _opts, callback) => {
			callback(null, { stdout: "garbage-line" });
		});
		const { getMonitorHandlesAsync } = await import("./monitorResolver");

		const handles = await getMonitorHandlesAsync();
		expect(handles).toHaveLength(1);
		expect(Number.isNaN(handles[0].handle)).toBe(true);
	});

	it("parses output for the synchronous diagnostic helper", async () => {
		spawnSyncMock.mockReturnValue({
			error: null,
			status: 0,
			stdout: MONITOR_OUTPUT,
		});
		const { getMonitorHandles } = await import("./monitorResolver");

		expect(getMonitorHandles()).toEqual([
			{ handle: 12345, x: 0, y: 0, width: 1920, height: 1080 },
			{ handle: 6789, x: 1920, y: 0, width: 2560, height: 1440 },
		]);
		expect(spawnSyncMock).toHaveBeenCalledTimes(1);
	});
});

describe("findMonitorHandleForElectronDisplay", () => {
	const physicalMonitors = [
		// Primary 2560x1440 physical @ 125% (Electron DIP bounds 2048x1152).
		{ handle: 111, x: 0, y: 0, width: 2560, height: 1440 },
		// Secondary 1920x1080 physical @ 100% to the right of the primary.
		{ handle: 222, x: 2560, y: 0, width: 1920, height: 1080 },
	];

	it("matches the monitor whose full physical rect equals DIP bounds x scale factor", () => {
		const display = { bounds: { x: 0, y: 0, width: 2048, height: 1152 }, scaleFactor: 1.25 };

		expect(findMonitorHandleForElectronDisplay(display, physicalMonitors)?.handle).toBe(111);
	});

	it("matches a secondary display whose DIP and physical origins coincide", () => {
		const display = { bounds: { x: 2560, y: 0, width: 1920, height: 1080 }, scaleFactor: 1 };

		expect(findMonitorHandleForElectronDisplay(display, physicalMonitors)?.handle).toBe(222);
	});

	it("separates same-DIP-size displays with different scale factors", () => {
		const monitors = [
			{ handle: 111, x: 0, y: 0, width: 3840, height: 2160 },
			// 4K @ 200% then a 1080p @ 100%: the external's physical origin and
			// its DIP origin coincide at x = 3840 (per-display DIP scaling).
			{ handle: 222, x: 3840, y: 0, width: 1920, height: 1080 },
		];
		// Both panels report DIP bounds 1920x1080; only the scale differs.
		const panel = { bounds: { x: 0, y: 0, width: 1920, height: 1080 }, scaleFactor: 2 };
		const external = { bounds: { x: 3840, y: 0, width: 1920, height: 1080 }, scaleFactor: 1 };

		expect(findMonitorHandleForElectronDisplay(panel, monitors)?.handle).toBe(111);
		expect(findMonitorHandleForElectronDisplay(external, monitors)?.handle).toBe(222);
	});

	it("tolerates small rounding differences in scaled coordinates", () => {
		const monitors = [{ handle: 111, x: 0, y: 0, width: 2561, height: 1439 }];
		const display = { bounds: { x: 0, y: 0, width: 2048, height: 1152 }, scaleFactor: 1.25 };

		expect(findMonitorHandleForElectronDisplay(display, monitors)?.handle).toBe(111);
	});

	it("returns null when no monitor origin is close, leaving the caller its fallback", () => {
		const display = { bounds: { x: 9000, y: 0, width: 1920, height: 1080 }, scaleFactor: 1 };

		expect(findMonitorHandleForElectronDisplay(display, physicalMonitors)).toBeNull();
		expect(findMonitorHandleForElectronDisplay(display, [])).toBeNull();
	});
});
