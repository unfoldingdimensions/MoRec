import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IpcRegistry } from "./test/ipcRegistry";

/**
 * State-machine tests for `electron/updater.ts` with a mocked
 * electron-updater: update availability, skip, download progress, ready +
 * install, error handling, deferral, and dismissal — asserted through the
 * exported status/toast getters and a toast-sender spy.
 */
type UpdaterHandler = (info: unknown) => void;

describe("updater state machine", () => {
	// Auto-updates only run in packaged builds (canUseAutoUpdates).
	const registry = new IpcRegistry({ app: { isPackaged: true } });
	let tempRoot: string;
	let updaterHandlers: Map<string, UpdaterHandler>;
	let autoUpdaterCalls: {
		checkForUpdates: ReturnType<typeof vi.fn>;
		downloadUpdate: ReturnType<typeof vi.fn>;
		quitAndInstall: ReturnType<typeof vi.fn>;
	};

	const sendToRenderer = vi.fn<(channel: string, payload: unknown) => boolean>(() => true);
	const getMainWindow = vi.fn(() => null);

	async function importUpdater() {
		return import("./updater");
	}

	async function setup() {
		const updater = await importUpdater();
		updater.setupAutoUpdates(getMainWindow, sendToRenderer as never);
		return updater;
	}

	function emit(event: string, info: unknown = {}) {
		const handler = updaterHandlers.get(event);
		if (!handler) throw new Error(`no handler for ${event}`);
		handler(info);
	}

	beforeEach(async () => {
		vi.resetModules();
		registry.reset();
		registry.installElectronMock();
		tempRoot = await mkdtemp(path.join(os.tmpdir(), "morec-updater-test-"));

		updaterHandlers = new Map();
		autoUpdaterCalls = {
			checkForUpdates: vi.fn(async () => undefined),
			downloadUpdate: vi.fn(async () => undefined),
			quitAndInstall: vi.fn(),
		};
		sendToRenderer.mockClear();
		getMainWindow.mockClear();

		vi.doMock("electron-updater", () => ({
			autoUpdater: {
				on: vi.fn((event: string, handler: UpdaterHandler) => {
					updaterHandlers.set(event, handler);
				}),
				setFeedURL: vi.fn(),
				checkForUpdates: autoUpdaterCalls.checkForUpdates,
				downloadUpdate: autoUpdaterCalls.downloadUpdate,
				quitAndInstall: autoUpdaterCalls.quitAndInstall,
				autoDownload: true,
				autoInstallOnAppQuit: true,
			},
		}));
		vi.doMock("./appPaths", () => ({ USER_DATA_PATH: tempRoot }));
	});

	afterEach(() => {
		vi.resetModules();
		vi.doUnmock("electron");
		vi.doUnmock("electron-updater");
		vi.doUnmock("./appPaths");
	});

	it("initializes to idle and reports up-to-date when no update exists", async () => {
		const updater = await setup();

		expect(updater.getUpdateStatusSummary().status).toBe("checking");
		emit("update-not-available");

		const summary = updater.getUpdateStatusSummary();
		expect(summary.status).toBe("up-to-date");
		expect(summary.availableVersion).toBeNull();
		expect(updater.getCurrentUpdateToastPayload()).toBeNull();
	});

	it("announces an available update and clears it when skipped", async () => {
		const updater = await setup();
		emit("update-available", { version: "1.1.0" });

		expect(updater.getUpdateStatusSummary().status).toBe("available");
		expect(updater.getUpdateStatusSummary().availableVersion).toBe("1.1.0");
		expect(updater.getCurrentUpdateToastPayload()).toMatchObject({
			version: "1.1.0",
			phase: "available",
		});
		expect(sendToRenderer).toHaveBeenCalledWith("update-toast-state", expect.anything());

		expect(updater.skipAvailableUpdateVersion(sendToRenderer as never)).toEqual({
			success: true,
		});
		expect(updater.getCurrentUpdateToastPayload()).toBeNull();

		// The skipped version must not re-announce a toast.
		sendToRenderer.mockClear();
		emit("update-available", { version: "1.1.0" });
		expect(updater.getCurrentUpdateToastPayload()).toBeNull();
		expect(sendToRenderer).not.toHaveBeenCalled();
	});

	it("streams download progress and reaches the ready state", async () => {
		const updater = await setup();
		emit("update-available", { version: "1.1.0" });
		sendToRenderer.mockClear();

		emit("download-progress", {
			percent: 42.5,
			transferred: 42,
			total: 100,
			bytesPerSecond: 2048,
		});

		expect(updater.getUpdateStatusSummary().status).toBe("downloading");
		// Progress percent is rounded to an integer in the toast payload.
		expect(updater.getCurrentUpdateToastPayload()).toMatchObject({
			phase: "downloading",
			version: "1.1.0",
			progressPercent: 43,
			totalBytes: 100,
		});

		emit("update-downloaded", { version: "1.1.0" });

		expect(updater.getUpdateStatusSummary().status).toBe("ready");
		expect(updater.getCurrentUpdateToastPayload()).toMatchObject({
			phase: "ready",
			version: "1.1.0",
		});
	});

	it("installs the downloaded update on request", async () => {
		const updater = await setup();
		emit("update-available", { version: "1.1.0" });
		emit("update-downloaded", { version: "1.1.0" });

		updater.installDownloadedUpdateNow(sendToRenderer as never);
		expect(autoUpdaterCalls.quitAndInstall).toHaveBeenCalledTimes(1);
	});

	it("reports a download failure through status and toast", async () => {
		const updater = await setup();
		emit("update-available", { version: "1.1.0" });

		const result = await updater.downloadAvailableUpdate(sendToRenderer as never);
		expect(result.success).toBe(true);

		emit("error", new Error("network gone"));

		expect(updater.getUpdateStatusSummary().status).toBe("error");
		expect(updater.getCurrentUpdateToastPayload()).toMatchObject({
			phase: "error",
			version: "1.1.0",
		});
	});

	it("refuses downloads when no update is available", async () => {
		const updater = await setup();

		expect(await updater.downloadAvailableUpdate(sendToRenderer as never)).toEqual({
			success: false,
			message: "No update is ready to download.",
		});
		expect(autoUpdaterCalls.downloadUpdate).not.toHaveBeenCalled();
	});

	it("defers the reminder and re-sends it after the delay", async () => {
		vi.useFakeTimers();
		try {
			const updater = await setup();
			emit("update-available", { version: "1.1.0" });

			expect(updater.deferUpdateReminder(getMainWindow, sendToRenderer as never)).toEqual({
				success: true,
			});
			// Deferral clears the visible toast.
			expect(updater.getCurrentUpdateToastPayload()).toBeNull();

			// 3h reminder delay.
			await vi.advanceTimersByTimeAsync(3 * 60 * 60 * 1000 + 1000);

			expect(updater.getCurrentUpdateToastPayload()).toMatchObject({
				phase: "available",
				version: "1.1.0",
			});
		} finally {
			vi.useRealTimers();
		}
	});

	it("dismisses the visible toast", async () => {
		const updater = await setup();
		emit("update-available", { version: "1.1.0" });
		expect(updater.getCurrentUpdateToastPayload()).not.toBeNull();

		updater.dismissUpdateToast(getMainWindow, sendToRenderer as never);
		expect(updater.getCurrentUpdateToastPayload()).toBeNull();
	});
});
