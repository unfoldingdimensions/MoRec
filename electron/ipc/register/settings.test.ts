import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IpcRegistry } from "../../test/ipcRegistry";

/**
 * Handler-level tests for `register/settings.ts`: app-settings persistence,
 * shortcuts, recording preferences, and the countdown state machine
 * (including the clamping and load-fail-safe contracts).
 */
describe("register/settings handlers", () => {
	const registry = new IpcRegistry();
	let tempRoot: string;
	let files: {
		appSettings: string;
		countdown: string;
		recordings: string;
		shortcuts: string;
	};

	let countdownWindow: {
		isDestroyed: () => boolean;
		webContents: {
			isLoadingMainFrame: () => boolean;
			send: ReturnType<typeof vi.fn>;
			once: ReturnType<typeof vi.fn>;
			off: ReturnType<typeof vi.fn>;
		};
	};
	let countdownWindowCreated: number;

	beforeEach(async () => {
		vi.useFakeTimers();
		tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "morec-settings-test-"));
		files = {
			appSettings: path.join(tempRoot, "app-settings.json"),
			countdown: path.join(tempRoot, "countdown.json"),
			recordings: path.join(tempRoot, "recordings.json"),
			shortcuts: path.join(tempRoot, "shortcuts.json"),
		};

		vi.resetModules();
		registry.reset();
		registry.installElectronMock();

		countdownWindow = {
			isDestroyed: () => false,
			once: vi.fn(),
			off: vi.fn(),
			webContents: {
				isLoadingMainFrame: () => false,
				send: vi.fn(),
				once: vi.fn(),
				off: vi.fn(),
			},
		};
		countdownWindowCreated = 0;

		vi.doMock("../../windows", () => ({
			createCountdownWindow: vi.fn(() => {
				countdownWindowCreated += 1;
				return countdownWindow;
			}),
			closeCountdownWindow: vi.fn(),
			getCountdownWindow: vi.fn(() => countdownWindow),
		}));
		vi.doMock("../../cursorHider", () => ({
			hideCursor: vi.fn(() => true),
			showCursor: vi.fn(),
		}));
		vi.doMock("../constants", () => ({
			APP_SETTINGS_FILE: files.appSettings,
			COUNTDOWN_SETTINGS_FILE: files.countdown,
			RECORDINGS_SETTINGS_FILE: files.recordings,
			SHORTCUTS_FILE: files.shortcuts,
		}));
		// Live countdown state backed by a mutable store (the real module uses
		// exported `let` bindings that live-update inside the bundled CJS).
		const countdownState = {
			countdownInProgress: false,
			countdownCancelled: false,
			countdownRemaining: null as number | null,
			countdownTimer: null as ReturnType<typeof setInterval> | null,
		};
		vi.doMock("../state", () => ({
			get countdownInProgress() {
				return countdownState.countdownInProgress;
			},
			get countdownCancelled() {
				return countdownState.countdownCancelled;
			},
			get countdownRemaining() {
				return countdownState.countdownRemaining;
			},
			get countdownTimer() {
				return countdownState.countdownTimer;
			},
			setCountdownInProgress: (v: boolean) => {
				countdownState.countdownInProgress = v;
			},
			setCountdownCancelled: (v: boolean) => {
				countdownState.countdownCancelled = v;
			},
			setCountdownRemaining: (v: number | null) => {
				countdownState.countdownRemaining = v;
			},
			setCountdownTimer: (v: ReturnType<typeof setInterval> | null) => {
				countdownState.countdownTimer = v;
			},
		}));

		const { registerSettingsHandlers } = await import("./settings");
		registerSettingsHandlers();
	});

	afterEach(async () => {
		vi.useRealTimers();
		vi.resetModules();
		vi.doUnmock("electron");
		vi.doUnmock("../../windows");
		vi.doUnmock("../../cursorHider");
		vi.doUnmock("../constants");
		vi.doUnmock("../state");
		await fs.rm(tempRoot, { recursive: true, force: true });
	});

	describe("app-settings", () => {
		it("returns null for unset keys and persists set values", async () => {
			expect(await registry.invoke("app-settings:get", "theme")).toEqual({
				success: true,
				value: null,
			});

			expect(await registry.invoke("app-settings:set", "theme", "dark")).toEqual({
				success: true,
			});
			// Writes are debounced.
			await vi.advanceTimersByTimeAsync(400);

			// The debounced save writes via real fs; retry-read so a slow disk
			// completion cannot race the assertion.
			let stored: { theme?: string } = {};
			for (let attempt = 0; attempt < 20 && stored.theme !== "dark"; attempt += 1) {
				await vi.advanceTimersByTimeAsync(50);
				try {
					stored = JSON.parse(await fs.readFile(files.appSettings, "utf-8"));
				} catch {
					// File not written yet.
				}
			}
			expect(stored.theme).toBe("dark");
			expect(await registry.invoke("app-settings:get", "theme")).toEqual({
				success: true,
				value: "dark",
			});
		});

		it("rejects invalid keys", async () => {
			expect(await registry.invoke("app-settings:get", "")).toEqual({
				success: false,
				value: null,
			});
			expect(await registry.invoke("app-settings:set", 42, "x")).toEqual({ success: false });
		});

		it("flushes pending debounced settings on before-quit", async () => {
			await registry.invoke("app-settings:set", "key", "value");
			registry.emitAppEvent("before-quit");

			const stored = JSON.parse(await fs.readFile(files.appSettings, "utf-8"));
			expect(stored.key).toBe("value");
		});
	});

	describe("shortcuts", () => {
		it("round-trips shortcuts and returns null when missing", async () => {
			expect(await registry.invoke("get-shortcuts")).toBeNull();

			const shortcuts = { startRecording: "CmdOrCtrl+R" };
			expect(await registry.invoke("save-shortcuts", shortcuts)).toEqual({ success: true });
			expect(await registry.invoke("get-shortcuts")).toEqual(shortcuts);
		});
	});

	describe("recording preferences", () => {
		it("returns defaults when no preference file exists", async () => {
			expect(await registry.invoke("get-recording-preferences")).toEqual({
				success: true,
				microphoneEnabled: false,
				microphoneDeviceId: undefined,
				systemAudioEnabled: false,
				webcamEnabled: false,
				webcamDeviceId: undefined,
			});
		});

		it("merges partial preference updates", async () => {
			await registry.invoke("set-recording-preferences", { microphoneEnabled: true });
			await registry.invoke("set-recording-preferences", { webcamEnabled: true });

			const prefs = (await registry.invoke("get-recording-preferences")) as Record<
				string,
				unknown
			>;
			expect(prefs.microphoneEnabled).toBe(true);
			expect(prefs.webcamEnabled).toBe(true);
			expect(prefs.systemAudioEnabled).toBe(false);
		});
	});

	describe("countdown", () => {
		it("ticks down and resolves successfully", async () => {
			const startPromise = registry.invoke("start-countdown", 3);

			await vi.advanceTimersByTimeAsync(1000);
			await vi.advanceTimersByTimeAsync(1000);
			await vi.advanceTimersByTimeAsync(1000);

			expect(await startPromise).toEqual({ success: true });
			// Initial tick + two countdown ticks (1s and 2s marks).
			const ticks = countdownWindow.webContents.send.mock.calls.filter(
				([channel]) => channel === "countdown-tick",
			);
			expect(ticks.length).toBeGreaterThanOrEqual(2);
		});

		it("clamps invalid seconds to a positive integer instead of hanging", async () => {
			const startPromise = registry.invoke("start-countdown", Number.NaN);

			await vi.advanceTimersByTimeAsync(1000);
			await vi.advanceTimersByTimeAsync(1000);

			// A clamped 1-second countdown resolves after the first tick.
			expect(await startPromise).toEqual({ success: true });
			// The countdown window was created and torn down cleanly.
			expect(countdownWindowCreated).toBe(1);
		});

		it("rejects a second concurrent start", async () => {
			const first = registry.invoke("start-countdown", 5);
			await vi.advanceTimersByTimeAsync(0);

			expect(await registry.invoke("start-countdown", 5)).toEqual({
				success: false,
				error: "Countdown already in progress",
			});

			await vi.advanceTimersByTimeAsync(5000);
			expect(await first).toEqual({ success: true });
		});

		it("cancel resolves the in-flight countdown and unblocks future ones", async () => {
			const first = registry.invoke("start-countdown", 5);
			await vi.advanceTimersByTimeAsync(1000);

			expect(await registry.invoke("cancel-countdown")).toEqual({ success: true });
			// The interval's next tick observes the cancellation and resolves.
			await vi.advanceTimersByTimeAsync(1000);
			expect(await first).toEqual({ success: false, cancelled: true });

			// A new countdown is no longer blocked by "already in progress".
			const second = registry.invoke("start-countdown", 1);
			await vi.advanceTimersByTimeAsync(1000);
			expect(await second).toEqual({ success: true });
		});

		it("resolves via the fail-safe when the countdown window never finishes loading", async () => {
			countdownWindow.webContents.isLoadingMainFrame = () => true;
			// once() registered for did-finish-load never fires.
			countdownWindow.webContents.once = vi.fn();

			const startPromise = registry.invoke("start-countdown", 1);

			// Past the 10s fail-safe plus the 1s tick.
			await vi.advanceTimersByTimeAsync(11_000);

			expect(await startPromise).toEqual({ success: true });
		});
	});
});
