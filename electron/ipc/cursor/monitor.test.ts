import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { spawnMock, accessMock } = vi.hoisted(() => ({
	spawnMock: vi.fn(),
	accessMock: vi.fn(),
}));

vi.mock("node:child_process", () => ({
	spawn: spawnMock,
}));

vi.mock("node:fs/promises", () => ({
	default: {
		access: accessMock,
	},
}));

vi.mock("electron", () => ({
	BrowserWindow: {
		getAllWindows: vi.fn(() => []),
	},
}));

vi.mock("../paths/binaries", () => ({
	getCursorMonitorExePath: vi.fn(() => "C:\\fake\\cursor-monitor.exe"),
	ensureNativeCursorMonitorBinary: vi.fn(),
}));

vi.mock("./telemetry", () => ({
	sampleCursorStateChange: vi.fn(),
}));

vi.mock("../state", () => {
	const state = {
		cursorVisualType: "arrow",
		outputBuffer: "",
		monitorProcess: null as unknown,
	};
	return {
		currentCursorVisualType: state.cursorVisualType,
		nativeCursorMonitorOutputBuffer: state.outputBuffer,
		get nativeCursorMonitorProcess() {
			return state.monitorProcess;
		},
		setCurrentCursorVisualType: vi.fn((value: string) => {
			state.cursorVisualType = value;
		}),
		setNativeCursorMonitorOutputBuffer: vi.fn((value: string) => {
			state.outputBuffer = value;
		}),
		setNativeCursorMonitorProcess: vi.fn((value: unknown) => {
			state.monitorProcess = value;
		}),
	};
});

import { startNativeCursorMonitor, stopNativeCursorMonitor } from "./monitor";

function createFakeHelperProcess() {
	return {
		stdin: { on: vi.fn(), write: vi.fn() },
		stdout: { on: vi.fn() },
		stderr: { on: vi.fn() },
		once: vi.fn(),
		kill: vi.fn(),
	};
}

describe("native cursor monitor spawn (Windows)", () => {
	beforeEach(() => {
		// CI runs on Linux; pin the win32 branch the helper takes so the test
		// exercises the same spawn path on every platform.
		vi.spyOn(process, "platform", "get").mockReturnValue("win32");
		spawnMock.mockReset();
		accessMock.mockReset();
		accessMock.mockResolvedValue(undefined);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("spawns the console-subsystem helper with windowsHide", async () => {
		spawnMock.mockImplementation(() => createFakeHelperProcess());

		await startNativeCursorMonitor();

		expect(spawnMock).toHaveBeenCalledTimes(1);
		const options = spawnMock.mock.calls[0]?.[2] as { windowsHide?: boolean } | undefined;
		expect(options?.windowsHide).toBe(true);
	});

	it("does not orphan the helper when stop lands during the async start", async () => {
		// The helper binary check is in flight when stop arrives; the start
		// must give up instead of spawning an untracked helper afterwards.
		let releaseAccess!: () => void;
		accessMock.mockImplementation(
			() =>
				new Promise<void>((resolve) => {
					releaseAccess = resolve;
				}),
		);
		spawnMock.mockImplementation(() => createFakeHelperProcess());

		const startPromise = startNativeCursorMonitor();
		await new Promise((resolve) => setTimeout(resolve, 0));

		stopNativeCursorMonitor();
		releaseAccess();
		await startPromise;

		expect(spawnMock).not.toHaveBeenCalled();
	});

	it("reaps a spawned helper when stop lands before registration", async () => {
		const fakeProc = createFakeHelperProcess();
		spawnMock.mockImplementation(() => fakeProc);

		await startNativeCursorMonitor();
		expect(spawnMock).toHaveBeenCalledTimes(1);

		stopNativeCursorMonitor();
		expect(fakeProc.stdin.write).toHaveBeenCalledWith("stop\n");
		expect(fakeProc.kill).toHaveBeenCalled();
	});
});
