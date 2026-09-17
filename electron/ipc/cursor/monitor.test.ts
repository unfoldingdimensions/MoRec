import { beforeEach, describe, expect, it, vi } from "vitest";

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

import { startNativeCursorMonitor } from "./monitor";

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
		spawnMock.mockReset();
		accessMock.mockReset();
		accessMock.mockResolvedValue(undefined);
	});

	it("spawns the console-subsystem helper with windowsHide", async () => {
		spawnMock.mockImplementation(() => createFakeHelperProcess());

		await startNativeCursorMonitor();

		expect(spawnMock).toHaveBeenCalledTimes(1);
		const options = spawnMock.mock.calls[0]?.[2] as { windowsHide?: boolean } | undefined;
		expect(options?.windowsHide).toBe(true);
	});
});
