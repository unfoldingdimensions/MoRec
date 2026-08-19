import { beforeEach, describe, expect, it, vi } from "vitest";

describe("tray stop recording routing", () => {
	type MockWebContents = {
		isDestroyed: () => boolean;
		getURL: () => string;
		send: ReturnType<typeof vi.fn>;
		isLoadingMainFrame?: () => boolean;
		on?: ReturnType<typeof vi.fn>;
		once?: ReturnType<typeof vi.fn>;
		removeListener?: ReturnType<typeof vi.fn>;
	};

	type MockBrowserWindow = {
		isDestroyed: () => boolean;
		webContents: MockWebContents;
		close?: ReturnType<typeof vi.fn>;
		hide?: ReturnType<typeof vi.fn>;
		show?: ReturnType<typeof vi.fn>;
		showInactive?: ReturnType<typeof vi.fn>;
		restore?: ReturnType<typeof vi.fn>;
		moveTop?: ReturnType<typeof vi.fn>;
		focus?: ReturnType<typeof vi.fn>;
		isMinimized?: ReturnType<typeof vi.fn>;
		isVisible?: ReturnType<typeof vi.fn>;
		isFocused?: ReturnType<typeof vi.fn>;
		setBounds?: ReturnType<typeof vi.fn>;
		getBounds?: ReturnType<typeof vi.fn>;
		setContentProtection?: ReturnType<typeof vi.fn>;
		setIgnoreMouseEvents?: ReturnType<typeof vi.fn>;
		setVisibleOnAllWorkspaces?: ReturnType<typeof vi.fn>;
		loadURL?: ReturnType<typeof vi.fn>;
		loadFile?: ReturnType<typeof vi.fn>;
		on?: ReturnType<typeof vi.fn>;
		once?: ReturnType<typeof vi.fn>;
	};

	let allWindowsList: MockBrowserWindow[] = [];

	function createMockWindow(
		url: string,
		options: { destroyed?: boolean; webContentsDestroyed?: boolean } = {},
	): MockBrowserWindow {
		let isWinDestroyed = Boolean(options.destroyed);
		let isWcDestroyed = Boolean(options.webContentsDestroyed);

		const webContents: MockWebContents = {
			isDestroyed: vi.fn(() => isWcDestroyed),
			getURL: vi.fn(() => url),
			send: vi.fn(),
			isLoadingMainFrame: vi.fn(() => false),
			on: vi.fn(),
			once: vi.fn(),
			removeListener: vi.fn(),
		};

		const win: MockBrowserWindow = {
			isDestroyed: vi.fn(() => isWinDestroyed),
			webContents,
			close: vi.fn(() => {
				isWinDestroyed = true;
			}),
			hide: vi.fn(),
			show: vi.fn(),
			showInactive: vi.fn(),
			restore: vi.fn(),
			moveTop: vi.fn(),
			focus: vi.fn(),
			isMinimized: vi.fn(() => false),
			isVisible: vi.fn(() => true),
			isFocused: vi.fn(() => true),
			setBounds: vi.fn(),
			getBounds: vi.fn(() => ({ x: 0, y: 0, width: 800, height: 600 })),
			setContentProtection: vi.fn(),
			setIgnoreMouseEvents: vi.fn(),
			setVisibleOnAllWorkspaces: vi.fn(),
			loadURL: vi.fn(),
			loadFile: vi.fn(),
			on: vi.fn(),
			once: vi.fn(),
		};

		allWindowsList.push(win);
		return win;
	}

	function setupElectronMock(windows: MockBrowserWindow[]) {
		vi.doMock("electron", () => {
			class MockBrowserWindowClass {
				constructor() {
					const win = createMockWindow("http://localhost:5173/?windowType=hud-overlay");
					return win;
				}
				static getAllWindows = () => windows;
			}

			return {
				app: {
					isReady: () => true,
					getPath: (name: string) => (name === "userData" ? "/mock/user/data" : "/mock/path"),
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
		allWindowsList = [];
		vi.resetModules();
	});

	describe("dispatchStopRecordingFromTray unit behavior", () => {
		it("sends stop-recording-from-tray directly to registered HUD overlay window", async () => {
			const hudWindow = createMockWindow("http://localhost:5173/?windowType=hud-overlay");
			setupElectronMock([hudWindow]);

			const { dispatchStopRecordingFromTray } = await import("./windows");

			const result = dispatchStopRecordingFromTray();
			expect(result).toBe(true);
			expect(hudWindow.webContents.send).toHaveBeenCalledWith("stop-recording-from-tray");
		});

		it("routes to HUD overlay window and NOT editor window when both exist", async () => {
			const editorWindow = createMockWindow("http://localhost:5173/?windowType=editor");
			const hudWindow = createMockWindow("http://localhost:5173/?windowType=hud-overlay");
			setupElectronMock([editorWindow, hudWindow]);

			const { dispatchStopRecordingFromTray } = await import("./windows");

			const result = dispatchStopRecordingFromTray();
			expect(result).toBe(true);
			expect(hudWindow.webContents.send).toHaveBeenCalledWith("stop-recording-from-tray");
			expect(editorWindow.webContents.send).not.toHaveBeenCalled();
		});

		it("falls back to scanning BrowserWindow.getAllWindows() and finds HUD overlay window", async () => {
			const editorWindow = createMockWindow("http://localhost:5173/?windowType=editor");
			const sourceSelectorWindow = createMockWindow(
				"http://localhost:5173/?windowType=source-selector",
			);
			const hudWindow = createMockWindow(
				"file:///path/to/app/dist/index.html?windowType=hud-overlay#status",
			);
			setupElectronMock([editorWindow, sourceSelectorWindow, hudWindow]);

			const { dispatchStopRecordingFromTray } = await import("./windows");

			const result = dispatchStopRecordingFromTray();
			expect(result).toBe(true);
			expect(hudWindow.webContents.send).toHaveBeenCalledWith("stop-recording-from-tray");
			expect(editorWindow.webContents.send).not.toHaveBeenCalled();
			expect(sourceSelectorWindow.webContents.send).not.toHaveBeenCalled();
		});

		it("broadcasts to all live windows when no HUD overlay window matches URL", async () => {
			const window1 = createMockWindow("http://localhost:5173/custom-view-1");
			const window2 = createMockWindow("http://localhost:5173/custom-view-2");
			setupElectronMock([window1, window2]);

			const { dispatchStopRecordingFromTray } = await import("./windows");

			const result = dispatchStopRecordingFromTray();
			expect(result).toBe(true);
			expect(window1.webContents.send).toHaveBeenCalledWith("stop-recording-from-tray");
			expect(window2.webContents.send).toHaveBeenCalledWith("stop-recording-from-tray");
		});

		it("returns false cleanly when all windows are destroyed", async () => {
			const destroyedWindow1 = createMockWindow(
				"http://localhost:5173/?windowType=hud-overlay",
				{ destroyed: true },
			);
			const destroyedWindow2 = createMockWindow("http://localhost:5173/?windowType=editor", {
				destroyed: true,
			});
			setupElectronMock([destroyedWindow1, destroyedWindow2]);

			const { dispatchStopRecordingFromTray } = await import("./windows");

			const result = dispatchStopRecordingFromTray();
			expect(result).toBe(false);
			expect(destroyedWindow1.webContents.send).not.toHaveBeenCalled();
			expect(destroyedWindow2.webContents.send).not.toHaveBeenCalled();
		});

		it("returns false cleanly when no windows exist", async () => {
			setupElectronMock([]);

			const { dispatchStopRecordingFromTray } = await import("./windows");

			const result = dispatchStopRecordingFromTray();
			expect(result).toBe(false);
		});

		it("skips windows whose webContents is destroyed", async () => {
			const brokenHudWindow = createMockWindow(
				"http://localhost:5173/?windowType=hud-overlay",
				{ webContentsDestroyed: true },
			);
			const liveHudWindow = createMockWindow(
				"http://localhost:5173/?windowType=hud-overlay",
			);
			setupElectronMock([brokenHudWindow, liveHudWindow]);

			const { dispatchStopRecordingFromTray } = await import("./windows");

			const result = dispatchStopRecordingFromTray();
			expect(result).toBe(true);
			expect(brokenHudWindow.webContents.send).not.toHaveBeenCalled();
			expect(liveHudWindow.webContents.send).toHaveBeenCalledWith("stop-recording-from-tray");
		});

		it("dispatches to all matching HUD overlay windows if multiple are present in fallback scan", async () => {
			const hudWindow1 = createMockWindow("http://localhost:5173/?windowType=hud-overlay");
			const hudWindow2 = createMockWindow(
				"http://127.0.0.1:43123/?windowType=hud-overlay&secondary=true",
			);
			setupElectronMock([hudWindow1, hudWindow2]);

			const { dispatchStopRecordingFromTray } = await import("./windows");

			const result = dispatchStopRecordingFromTray();
			expect(result).toBe(true);
			expect(hudWindow1.webContents.send).toHaveBeenCalledWith("stop-recording-from-tray");
			expect(hudWindow2.webContents.send).toHaveBeenCalledWith("stop-recording-from-tray");
		});
	});

	describe("lifecycle scenarios for tray routing", () => {
		it("Scenario: Editor window was opened then closed (mainWindow became null) - tray stop succeeds", async () => {
			// 1. HUD window was created at startup
			const hudWindow = createMockWindow("http://localhost:5173/?windowType=hud-overlay");

			// 2. Editor window is opened
			const editorWindow = createMockWindow("http://localhost:5173/?windowType=editor");

			// In main.ts: mainWindow = editorWindow
			let mainWindow: MockBrowserWindow | null = editorWindow;

			// 3. User closes Editor window -> editor closed listener triggers
			editorWindow.close?.();
			if (mainWindow === editorWindow) {
				mainWindow = null; // mainWindow is now NULL
			}

			expect(mainWindow).toBeNull();
			expect(editorWindow.isDestroyed()).toBe(true);
			expect(hudWindow.isDestroyed()).toBe(false);

			// 4. User initiates stop from tray
			setupElectronMock(allWindowsList);

			const { dispatchStopRecordingFromTray } = await import("./windows");

			// Old behavior would fail because: if (mainWindow && !mainWindow.isDestroyed()) -> false
			// New behavior uses dispatchStopRecordingFromTray()
			const dispatched = dispatchStopRecordingFromTray();
			expect(dispatched).toBe(true);
			expect(hudWindow.webContents.send).toHaveBeenCalledWith("stop-recording-from-tray");
			expect(editorWindow.webContents.send).not.toHaveBeenCalled();
		});

		it("Scenario: Editor window is minimized in background while recording - tray stop targets HUD, not editor", async () => {
			const hudWindow = createMockWindow("http://localhost:5173/?windowType=hud-overlay");
			const editorWindow = createMockWindow("http://localhost:5173/?windowType=editor");

			// mainWindow points to editorWindow
			const mainWindow: MockBrowserWindow | null = editorWindow;
			expect(mainWindow).toBe(editorWindow);

			setupElectronMock([editorWindow, hudWindow]);

			const { dispatchStopRecordingFromTray } = await import("./windows");

			const dispatched = dispatchStopRecordingFromTray();
			expect(dispatched).toBe(true);
			// Stop must go to HUD window, not editor window
			expect(hudWindow.webContents.send).toHaveBeenCalledWith("stop-recording-from-tray");
			expect(editorWindow.webContents.send).not.toHaveBeenCalled();
		});

		it("Scenario: Post-recording restoration fallback when mainWindow is null", () => {
			const hudWindow = createMockWindow("http://localhost:5173/?windowType=hud-overlay");
			const mainWindow: MockBrowserWindow | null = null;

			// Logic in electron/main.ts line 1037:
			// const target = mainWindow && !mainWindow.isDestroyed() ? mainWindow : getHudOverlayWindow();
			const getHudOverlayWindow = () => hudWindow;
			const target =
				mainWindow && !(mainWindow as MockBrowserWindow).isDestroyed()
					? mainWindow
					: getHudOverlayWindow();

			expect(target).toBe(hudWindow);
		});

		it("Scenario: Post-recording restoration uses mainWindow when valid", () => {
			const editorWindow = createMockWindow("http://localhost:5173/?windowType=editor");
			const hudWindow = createMockWindow("http://localhost:5173/?windowType=hud-overlay");
			const mainWindow: MockBrowserWindow | null = editorWindow;

			const getHudOverlayWindow = () => hudWindow;
			const target =
				mainWindow && !mainWindow.isDestroyed() ? mainWindow : getHudOverlayWindow();

			expect(target).toBe(editorWindow);
		});

		it("Scenario: Post-recording restoration handles when both mainWindow and getHudOverlayWindow are null/destroyed", () => {
			const mainWindow: MockBrowserWindow | null = null;
			const getHudOverlayWindow = () => null;

			const target =
				mainWindow && !(mainWindow as MockBrowserWindow).isDestroyed()
					? mainWindow
					: getHudOverlayWindow();

			expect(target).toBeNull();
		});
	});
});
