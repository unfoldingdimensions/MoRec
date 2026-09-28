import { beforeEach, describe, expect, it, vi } from "vitest";
import { IpcRegistry } from "../../test/ipcRegistry";
import { createMockWebContents } from "../../test/ipcRegistry";

/**
 * Handler-level tests for the mark-recording-segment IPC (P1 Feature 6).
 * The cursor-capture clock is mocked so the pause-aware elapsed-time contract
 * (never Date.now()) can be asserted through the handler's return value.
 */

const elapsedMock = vi.hoisted(() => ({ value: 0 }));
const targetPathMock = vi.hoisted(() => ({ value: null as string | null }));
const marksModule = vi.hoisted(() => {
	let marks: number[] = [];
	return {
		beginRecordingCapture: (videoPath: string | null) => {
			marks = [];
			targetPathMock.value = videoPath;
		},
		resetRecordingMarks: () => {
			marks = [];
		},
		addRecordingMark: (elapsedMs: number) => {
			const markMs = Math.round(elapsedMs);
			const previous = marks[marks.length - 1];
			if (
				Number.isFinite(markMs) &&
				markMs >= 250 &&
				(previous === undefined || markMs - previous >= 500)
			) {
				marks = [...marks, markMs];
			}
			return [...marks];
		},
		getRecordingMarks: () => [...marks],
		getRecordingTargetPath: () => targetPathMock.value,
	};
});

vi.doMock("../cursor/telemetry", () => ({
	getCursorCaptureElapsedMs: vi.fn(() => elapsedMock.value),
	normalizeCursorTelemetrySamples: vi.fn((v: unknown) => v),
	pauseCursorCaptureAtBoundary: vi.fn(),
	persistPendingCursorTelemetry: vi.fn(async () => undefined),
	resetCursorCaptureClock: vi.fn(),
	resumeCursorCapture: vi.fn(),
	sampleCursorPoint: vi.fn(() => null),
	snapshotCursorTelemetryForPersistence: vi.fn(),
	startCursorSampling: vi.fn(),
	stopCursorCapture: vi.fn(),
	writeCursorTelemetry: vi.fn(),
	pauseCursorCapture: vi.fn(),
}));
vi.doMock("../cursor/interaction", () => ({
	startInteractionCapture: vi.fn(),
	stopInteractionCapture: vi.fn(),
}));
vi.doMock("../cursor/bounds", () => ({
	startWindowBoundsCapture: vi.fn(),
	stopWindowBoundsCapture: vi.fn(),
}));
vi.doMock("../cursor/monitor", () => ({
	startNativeCursorMonitor: vi.fn(async () => undefined),
	stopNativeCursorMonitor: vi.fn(),
}));
vi.doMock("../../cursorHider", () => ({ showCursor: vi.fn(), hideCursor: vi.fn(() => true) }));
vi.doMock("../recording/marks", () => marksModule);
vi.doMock("../project/session", () => ({
	persistRecordingMarksManifest: vi.fn(async () => undefined),
}));

describe("mark-recording-segment handler", () => {
	const registry = new IpcRegistry();

	beforeEach(async () => {
		vi.resetModules();
		registry.reset();
		registry.installElectronMock();
		elapsedMock.value = 0;
		targetPathMock.value = null;
		marksModule.beginRecordingCapture(null);

		const { registerRecordingHandlers } = await import("./recording");
		registerRecordingHandlers(undefined);
	});

	it("stamps the pause-aware clock while recording and returns the marks", async () => {
		await registry.invoke("set-recording-state", true);
		elapsedMock.value = 3500;
		const first = await registry.invoke("mark-recording-segment");
		elapsedMock.value = 9000;
		const second = await registry.invoke("mark-recording-segment");

		expect(first).toMatchObject({ success: true, elapsedMs: 3500, marksMs: [3500] });
		expect(second).toMatchObject({ success: true, elapsedMs: 9000, marksMs: [3500, 9000] });
	});

	it("refuses to mark when recording is not active", async () => {
		const result = await registry.invoke("mark-recording-segment");
		expect(result).toMatchObject({ success: false });
		expect(result.marksMs).toBeUndefined();
	});

	it("persists the manifest per-mark when a target path is known", async () => {
		const sessionModule = await import("../project/session");
		await registry.invoke("set-recording-state", true);
		marksModule.beginRecordingCapture("/recordings/recording-1.mp4");

		elapsedMock.value = 2500;
		await registry.invoke("mark-recording-segment");

		expect(sessionModule.persistRecordingMarksManifest).toHaveBeenCalledWith(
			"/recordings/recording-1.mp4",
			[2500],
		);
	});
});
