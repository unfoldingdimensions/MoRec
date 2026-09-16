import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IpcRegistry } from "../test/ipcRegistry";

/**
 * Consent-gate tests for the renderer-invokable extension IPC channels:
 * `extensions:enable` and `extensions:marketplace-install` must show a
 * modal, cancel-default dialog bound to the sender window before doing
 * anything, and must refuse the action when it is declined. Also covers
 * sanitization of attacker-influenced extension ids and manifest names in
 * the dialog text (control characters, bidi overrides, length caps), and
 * that an unknown enable id short-circuits without a dialog.
 */
describe("extension IPC consent gates", () => {
	const showMessageBoxMock = vi.fn();
	const sentinelWindow = { id: "sentinel-window" };

	// The loader resolves its directories from app.getPath("userData"); point
	// it at a per-test temp directory via a closure over the mutable binding.
	const registry = new IpcRegistry({
		app: {
			getPath: (name: string) =>
				name === "userData" ? userDataDir : path.join(os.tmpdir(), "morec-test"),
		},
		BrowserWindow: {
			fromWebContents: () => sentinelWindow,
		},
		dialog: {
			showMessageBox: showMessageBoxMock,
		},
	});
	let userDataDir: string;

	beforeEach(async () => {
		vi.resetModules();
		registry.reset();
		showMessageBoxMock.mockReset();
		userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "morec-consent-test-"));
		registry.installElectronMock();
	});

	afterEach(async () => {
		vi.resetModules();
		vi.doUnmock("electron");
		await fs.rm(userDataDir, { recursive: true, force: true }).catch(() => undefined);
	});

	async function registerExtension(manifest: Record<string, unknown>) {
		const source = path.join(userDataDir, "source", String(manifest.id));
		await fs.mkdir(source, { recursive: true });
		await fs.writeFile(
			path.join(source, "morec-extension.json"),
			JSON.stringify(manifest, null, 2),
			"utf-8",
		);
		await fs.writeFile(path.join(source, "index.js"), "// entry", "utf-8");
		const loader = await import("../extensions/extensionLoader");
		const info = await loader.installExtensionFromPath(source);
		expect(info).not.toBeNull();
		return loader;
	}

	async function registerHandlers() {
		const { registerExtensionIpcHandlers } = await import("../extensions/extensionIpc");
		registerExtensionIpcHandlers();
	}

	// registry.invoke passes `null` as the event; the consent handlers read
	// event.sender, so call them with a mock invoke event instead.
	const invoke = (channel: string, ...args: unknown[]) => {
		const handler = registry.getHandler(channel);
		if (!handler) throw new Error(`No handler registered for channel "${channel}"`);
		return handler({ sender: { id: "sender-webcontents" } }, ...args);
	};

	it("enable shows a modal, cancel-default consent dialog bound to the sender window and refuses when declined", async () => {
		await registerExtension({
			id: "com.example.consent",
			name: "Consent",
			version: "1.0.0",
			main: "index.js",
			permissions: ["render"],
		});
		await registerHandlers();
		showMessageBoxMock.mockResolvedValue({ response: 0 });

		const result = await invoke("extensions:enable", "com.example.consent");

		expect(result).toEqual({ success: false, reason: "cancelled" });
		expect(showMessageBoxMock).toHaveBeenCalledTimes(1);
		const [dialogWindow, options] = showMessageBoxMock.mock.calls[0];
		// Bound to the sender's window — the box is modal to it.
		expect(dialogWindow).toBe(sentinelWindow);
		expect(options.defaultId).toBe(0);
		expect(options.cancelId).toBe(0);
		expect(options.buttons[0]).toBe("Cancel");
		expect(options.message).toContain("Consent");
		expect(options.detail).toContain("run code inside");

		// The declined enable must not flip any state — local or persisted.
		const loader = await import("../extensions/extensionLoader");
		expect(loader.getExtension("com.example.consent")?.status).toBe("installed");
		const persisted = JSON.parse(
			await fs.readFile(path.join(userDataDir, "extension-state.json"), "utf-8"),
		);
		expect(persisted["com.example.consent"]).toBe("installed");
	});

	it("enable activates the extension when the user accepts", async () => {
		await registerExtension({
			id: "com.example.consent",
			name: "Consent",
			version: "1.0.0",
			main: "index.js",
			permissions: ["render"],
		});
		await registerHandlers();
		showMessageBoxMock.mockResolvedValue({ response: 1 });

		const result = await invoke("extensions:enable", "com.example.consent");

		expect(result).toBe(true);
		const loader = await import("../extensions/extensionLoader");
		expect(loader.getExtension("com.example.consent")?.status).toBe("active");
		const persisted = JSON.parse(
			await fs.readFile(path.join(userDataDir, "extension-state.json"), "utf-8"),
		);
		expect(persisted["com.example.consent"]).toBe("active");
	});

	it("enable refuses unknown ids without showing a dialog", async () => {
		await registerHandlers();
		showMessageBoxMock.mockResolvedValue({ response: 1 });

		const result = await invoke("extensions:enable", "com.example.missing");

		expect(result).toBe(false);
		expect(showMessageBoxMock).not.toHaveBeenCalled();
	});

	it("enable lists requested permissions alongside the code-execution warning", async () => {
		await registerExtension({
			id: "com.example.perms",
			name: "Perms",
			version: "1.0.0",
			main: "index.js",
			permissions: ["render", "cursor"],
		});
		await registerHandlers();
		showMessageBoxMock.mockResolvedValue({ response: 0 });

		await invoke("extensions:enable", "com.example.perms");

		const [, options] = showMessageBoxMock.mock.calls[0];
		expect(options.detail).toContain("Permissions: render, cursor");
		expect(options.detail).toContain("run code inside");
	});

	it("enable does not imply a permissionless extension cannot run code", async () => {
		await registerExtension({
			id: "com.example.noperms",
			name: "No Perms",
			version: "1.0.0",
			main: "index.js",
			permissions: [],
		});
		await registerHandlers();
		showMessageBoxMock.mockResolvedValue({ response: 0 });

		await invoke("extensions:enable", "com.example.noperms");

		const [, options] = showMessageBoxMock.mock.calls[0];
		// No permissions line, but the code-execution warning is always there.
		expect(options.detail).not.toContain("Permissions:");
		expect(options.detail).toContain("run code inside");
	});

	it("marketplace-install skips the consent dialog for untrusted URLs and rejects in the downloader", async () => {
		await registerHandlers();
		showMessageBoxMock.mockResolvedValue({ response: 1 });

		const untrusted = await invoke(
			"extensions:marketplace-install",
			"com.example.cool",
			"https://evil.example/ext.zip",
		);
		expect(untrusted.success).toBe(false);
		expect(String(untrusted.error)).toContain("Untrusted download origin");
		expect(showMessageBoxMock).not.toHaveBeenCalled();

		const malformed = await invoke(
			"extensions:marketplace-install",
			"com.example.cool",
			"not a url",
		);
		expect(malformed).toEqual({ success: false, error: "Invalid download URL" });
		expect(showMessageBoxMock).not.toHaveBeenCalled();
	});

	it("marketplace-install refuses without downloading when consent is declined", async () => {
		await registerHandlers();
		showMessageBoxMock.mockResolvedValue({ response: 0 });

		const result = await invoke(
			"extensions:marketplace-install",
			"com.example.cool",
			"https://marketplace.morec.app/packs/cool.zip",
		);

		expect(result).toEqual({ success: false, reason: "cancelled" });
		expect(showMessageBoxMock).toHaveBeenCalledTimes(1);
		const [dialogWindow, options] = showMessageBoxMock.mock.calls[0];
		expect(dialogWindow).toBe(sentinelWindow);
		expect(options.defaultId).toBe(0);
		expect(options.cancelId).toBe(0);
		expect(options.buttons[0]).toBe("Cancel");
		expect(options.detail).toContain("run code inside");
	});

	it("sanitizes attacker-influenced name and id text in the enable dialog", async () => {
		const longName = `Trick\u202ERenamed\u202C Name\nwith newline  ${"Z".repeat(100)}`;
		const longId = `com.example.${"x".repeat(100)}`;
		await registerExtension({
			id: longId,
			name: longName,
			version: "1.0.0",
			main: "index.js",
			permissions: [],
		});
		await registerHandlers();
		showMessageBoxMock.mockResolvedValue({ response: 0 });

		await invoke("extensions:enable", longId);

		const [, options] = showMessageBoxMock.mock.calls[0];
		// No newlines, no bidi overrides, no unbounded length.
		expect(options.message).not.toContain("\n");
		expect(options.message).not.toContain("\u202E");
		expect(options.message).not.toContain("\u202C");
		expect(options.message).toContain("TrickRenamed Name with newline");
		expect(options.message.length).toBeLessThanOrEqual(90); // 80-cap + quotes

		// The id in the detail is capped at the same length (12 + 68 = 80).
		const idLine = options.detail.split("\n\n")[0];
		expect(idLine).toBe(`Extension ID: com.example.${"x".repeat(68)}`);
	});

	it("sanitizes the extension id in the marketplace install dialog", async () => {
		await registerHandlers();
		showMessageBoxMock.mockResolvedValue({ response: 0 });

		const hostileId = `com.evil\u202E${"y".repeat(100)}\nhack`;
		await invoke(
			"extensions:marketplace-install",
			hostileId,
			"https://marketplace.morec.app/packs/cool.zip",
		);

		const [dialogWindow, options] = showMessageBoxMock.mock.calls[0];
		expect(dialogWindow).toBe(sentinelWindow);
		expect(options.message).not.toContain("\n");
		expect(options.message).not.toContain("\u202E");
		expect(options.message).toContain("com.evil");
		// Trailing hostile payload is cut by the length cap.
		expect(options.message).not.toContain("hack");
		// The origin line stays intact and readable.
		expect(options.detail.startsWith("Download source: https://marketplace.morec.app")).toBe(
			true,
		);
	});

	describe("admin review channel registration", () => {
		it("does not register the admin review channels when MOREC_ADMIN_KEY is unset", async () => {
			delete process.env.MOREC_ADMIN_KEY;
			await registerHandlers();

			expect(registry.getHandler("extensions:reviews-list")).toBeUndefined();
			expect(registry.getHandler("extensions:review-update")).toBeUndefined();
		});

		it("registers the admin review channels only when MOREC_ADMIN_KEY is set", async () => {
			process.env.MOREC_ADMIN_KEY = "test-admin-key";
			try {
				await registerHandlers();

				expect(registry.getHandler("extensions:reviews-list")).toBeDefined();
				expect(registry.getHandler("extensions:review-update")).toBeDefined();
			} finally {
				delete process.env.MOREC_ADMIN_KEY;
			}
		});
	});
});
