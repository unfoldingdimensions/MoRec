import { beforeEach, describe, expect, it, vi } from "vitest";

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
