import os from "node:os";
import path from "node:path";
import { vi } from "vitest";

/**
 * Shared scaffolding for handler-level tests of `electron/ipc/register/*`
 * modules. Mirrors the established pattern from `register/project.test.ts`:
 * mock the `electron` module with an `ipcMain` that records registrations,
 * `vi.doMock` the state modules the module under test needs, dynamically
 * import it, call its register function, then `invoke()` handlers by channel.
 *
 * `vi.doMock` must be called from the test file's module context before the
 * dynamic `import()` of the register module — the helpers here do exactly
 * that, so import and call `registry.installElectronMock()` inside
 * `beforeEach` after `vi.resetModules()`.
 */

export type IpcHandler = (event: unknown, ...args: unknown[]) => Promise<unknown>;
type IpcListener = (...args: unknown[]) => void;

export type ElectronModuleOverrides = Record<string, unknown>;

export class IpcRegistry {
	private handlers = new Map<string, IpcHandler>();
	private listeners = new Map<string, IpcListener[]>();

	private electronOverrides: ElectronModuleOverrides;

	constructor(electronOverrides: ElectronModuleOverrides = {}) {
		this.electronOverrides = electronOverrides;
	}

	reset() {
		this.handlers.clear();
		this.listeners.clear();
	}

	installElectronMock() {
		this.reset();
		vi.doMock("electron", () => ({
			app: {
				getAppPath: () => process.cwd(),
				getPath: (name: string) => {
					if (name === "temp") return os.tmpdir();
					if (name === "userData") return path.join(os.tmpdir(), "morec-test-userdata");
					return process.cwd();
				},
				getVersion: () => "0.0.0-test",
				isPackaged: false,
				isReady: () => true,
				whenReady: async () => undefined,
				...(this.electronOverrides.app as object | undefined),
			},
			BrowserWindow: {
				getAllWindows: () => [],
				fromWebContents: () => null,
				...(this.electronOverrides.BrowserWindow as object | undefined),
			},
			dialog: {
				showOpenDialog: vi.fn(async () => ({ canceled: true, filePaths: [] })),
				showSaveDialog: vi.fn(async () => ({ canceled: true, filePath: undefined })),
				showMessageBox: vi.fn(async () => ({ response: 0 })),
				...(this.electronOverrides.dialog as object | undefined),
			},
			shell: {
				showItemInFolder: vi.fn(),
				openPath: vi.fn(async () => ""),
				openExternal: vi.fn(async () => undefined),
				...(this.electronOverrides.shell as object | undefined),
			},
			screen: {
				getAllDisplays: () => [],
				getPrimaryDisplay: () => ({ id: 0, bounds: { x: 0, y: 0, width: 1920, height: 1080 } }),
				on: vi.fn(),
				...(this.electronOverrides.screen as object | undefined),
			},
			Notification: vi.fn(),
			ipcMain: {
				handle: (channel: string, handler: IpcHandler) => {
					this.handlers.set(channel, handler);
				},
				removeHandler: (channel: string) => {
					this.handlers.delete(channel);
				},
				on: (channel: string, listener: IpcListener) => {
					const list = this.listeners.get(channel) ?? [];
					list.push(listener);
					this.listeners.set(channel, list);
				},
				removeListener: (channel: string, listener: IpcListener) => {
					const list = this.listeners.get(channel) ?? [];
					const index = list.indexOf(listener);
					if (index >= 0) list.splice(index, 1);
				},
				once: (channel: string, listener: IpcListener) => {
					const wrapped: IpcListener = (...args: unknown[]) => {
						this.remove(channel, listener);
						listener(...args);
					};
					const list = this.listeners.get(channel) ?? [];
					list.push(wrapped);
					this.listeners.set(channel, list);
				},
				removeAllListeners: (channel: string) => {
					this.listeners.delete(channel);
				},
			},
		}));
	}

	private remove(channel: string, listener: IpcListener) {
		const list = this.listeners.get(channel) ?? [];
		const index = list.indexOf(listener);
		if (index >= 0) list.splice(index, 1);
	}

	getHandler(channel: string): IpcHandler | undefined {
		return this.handlers.get(channel);
	}

	async invoke(channel: string, ...args: unknown[]): Promise<unknown> {
		const handler = this.handlers.get(channel);
		if (!handler) {
			throw new Error(`No handler registered for channel "${channel}"`);
		}
		return handler(null, ...args);
	}

	emit(channel: string, ...args: unknown[]) {
		for (const listener of this.listeners.get(channel) ?? []) {
			listener(...args);
		}
	}
}

/** Minimal mock `webContents` for handlers that push events back to a window. */
export function createMockWebContents() {
	return {
		isDestroyed: vi.fn(() => false),
		send: vi.fn(),
		isLoadingMainFrame: vi.fn(() => false),
		once: vi.fn(),
		off: vi.fn(),
	};
}
