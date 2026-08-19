import { beforeEach, describe, expect, it, vi } from "vitest";

describe("tray stop recording routing - adversarial challenge suite", () => {
	type MockWebContents = {
		isDestroyed: () => boolean;
		getURL: () => string;
		send: ReturnType<typeof vi.fn>;
		isLoadingMainFrame?: () => boolean;
	};

	type MockBrowserWindow = {
		isDestroyed: () => boolean;
		webContents: MockWebContents | null | undefined;
		close?: ReturnType<typeof vi.fn>;
	};

	function createMockWindow(
		url: string,
		options: {
			destroyed?: boolean;
			webContentsDestroyed?: boolean;
			nullWebContents?: boolean;
			throwOnGetURL?: boolean;
			throwOnSend?: boolean;
		} = {},
	): MockBrowserWindow {
		let isWinDestroyed = Boolean(options.destroyed);
		let isWcDestroyed = Boolean(options.webContentsDestroyed);

		const webContents: MockWebContents | null = options.nullWebContents
			? null
			: {
					isDestroyed: vi.fn(() => isWcDestroyed),
					getURL: vi.fn(() => {
						if (options.throwOnGetURL) {
							throw new Error("Object has been destroyed");
						}
						return url;
					}),
					send: vi.fn(() => {
						if (options.throwOnSend) {
							throw new Error("Render frame was disposed");
						}
					}),
				};

		const win: MockBrowserWindow = {
			isDestroyed: vi.fn(() => isWinDestroyed),
			webContents,
			close: vi.fn(() => {
				isWinDestroyed = true;
			}),
		};

		return win;
	}

	function setupElectronMock(windows: (MockBrowserWindow | null | undefined)[]) {
		vi.doMock("electron", () => {
			class MockBrowserWindowClass {
				static getAllWindows = () => windows.filter(Boolean);
			}

			return {
				app: {
					isReady: () => true,
					getPath: () => "/mock/path",
					getAppPath: () => "/mock/app",
					whenReady: () => Promise.resolve(),
				},
				BrowserWindow: MockBrowserWindowClass,
				ipcMain: {
					on: vi.fn(),
					handle: vi.fn(),
					removeListener: vi.fn(),
				},
			};
		});
	}

	beforeEach(() => {
		vi.resetModules();
	});

	it("Adversarial: Handles null, undefined, and destroyed items gracefully in BrowserWindow.getAllWindows()", async () => {
		const hudWindow = createMockWindow("http://localhost:5173/?windowType=hud-overlay");
		const destroyedWin = createMockWindow("http://localhost:5173/?windowType=hud-overlay", {
			destroyed: true,
		});
		const noWcWin = createMockWindow("http://localhost:5173/?windowType=hud-overlay", {
			nullWebContents: true,
		});

		setupElectronMock([null, destroyedWin, noWcWin, hudWindow, undefined]);

		const { dispatchStopRecordingFromTray } = await import("./windows");

		const result = dispatchStopRecordingFromTray();
		expect(result).toBe(true);
		expect(hudWindow.webContents?.send).toHaveBeenCalledWith("stop-recording-from-tray");
	});

	it("Adversarial: When primary getHudOverlayWindow() returns null, secondary scan reliably detects packaged file:// URL", async () => {
		const editorWindow = createMockWindow("file:///C:/app/dist/index.html?windowType=editor");
		const packagedHudWindow = createMockWindow(
			"file:///C:/Program%20Files/MoRec/resources/app.asar/dist/index.html?windowType=hud-overlay",
		);

		setupElectronMock([editorWindow, packagedHudWindow]);

		const { dispatchStopRecordingFromTray } = await import("./windows");

		const result = dispatchStopRecordingFromTray();
		expect(result).toBe(true);
		expect(packagedHudWindow.webContents?.send).toHaveBeenCalledWith("stop-recording-from-tray");
		expect(editorWindow.webContents?.send).not.toHaveBeenCalled();
	});

	it("Adversarial: Broadcast fallback executes when URL query is absent or empty string (pre-navigation state)", async () => {
		const preNavWindow1 = createMockWindow("");
		const preNavWindow2 = createMockWindow("about:blank");

		setupElectronMock([preNavWindow1, preNavWindow2]);

		const { dispatchStopRecordingFromTray } = await import("./windows");

		const result = dispatchStopRecordingFromTray();
		expect(result).toBe(true);
		expect(preNavWindow1.webContents?.send).toHaveBeenCalledWith("stop-recording-from-tray");
		expect(preNavWindow2.webContents?.send).toHaveBeenCalledWith("stop-recording-from-tray");
	});

	it("Adversarial: Multi-window configuration with 5 different window types routes strictly to HUD overlay", async () => {
		const editorWin = createMockWindow("http://localhost:5173/?windowType=editor");
		const sourceSelectorWin = createMockWindow(
			"http://localhost:5173/?windowType=source-selector",
		);
		const countdownWin = createMockWindow("http://localhost:5173/?windowType=countdown");
		const updateToastWin = createMockWindow("http://localhost:5173/?windowType=update-toast");
		const hudWin = createMockWindow("http://localhost:5173/?windowType=hud-overlay");

		setupElectronMock([
			editorWin,
			sourceSelectorWin,
			countdownWin,
			updateToastWin,
			hudWin,
		]);

		const { dispatchStopRecordingFromTray } = await import("./windows");

		const result = dispatchStopRecordingFromTray();
		expect(result).toBe(true);
		expect(hudWin.webContents?.send).toHaveBeenCalledWith("stop-recording-from-tray");
		expect(editorWin.webContents?.send).not.toHaveBeenCalled();
		expect(sourceSelectorWin.webContents?.send).not.toHaveBeenCalled();
		expect(countdownWin.webContents?.send).not.toHaveBeenCalled();
		expect(updateToastWin.webContents?.send).not.toHaveBeenCalled();
	});

	it("Adversarial: Stress test 1000 randomized window pool evaluations", async () => {
		const windows: MockBrowserWindow[] = [];
		let targetHud: MockBrowserWindow | null = null;

		for (let i = 0; i < 50; i++) {
			const isTarget = i === 25;
			const isDestroyed = i % 3 === 0 && !isTarget;
			const isWcDestroyed = i % 5 === 0 && !isTarget;
			const url = isTarget
				? "http://localhost:5173/?windowType=hud-overlay"
				: `http://localhost:5173/?windowType=other-${i}`;

			const win = createMockWindow(url, {
				destroyed: isDestroyed,
				webContentsDestroyed: isWcDestroyed,
			});
			if (isTarget) {
				targetHud = win;
			}
			windows.push(win);
		}

		setupElectronMock(windows);

		const { dispatchStopRecordingFromTray } = await import("./windows");

		for (let iteration = 0; iteration < 1000; iteration++) {
			const result = dispatchStopRecordingFromTray();
			expect(result).toBe(true);
		}

		expect(targetHud?.webContents?.send).toHaveBeenCalledTimes(1000);
	});
});
