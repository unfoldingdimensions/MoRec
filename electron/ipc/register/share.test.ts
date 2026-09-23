import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IpcRegistry } from "../../test/ipcRegistry";

/**
 * Handler-level tests for register/share.ts: the S3 secret key follows the
 * same encrypted-at-rest contract as the AI key (safeStorage mock, bytes
 * verified on disk, renderer only sees a boolean), and share-upload-recording
 * answers not-configured before touching the network.
 *
 * The fixture secret is a test-only value; tests assert on the encrypted
 * bytes, never echo the plaintext.
 */
describe("register/share handlers", () => {
	const registry = new IpcRegistry();
	let tempRoot: string;
	let appSettingsFile: string;
	const FIXTURE_SECRET = ["fixture", "secret", "not", "real"].join("-");

	beforeEach(async () => {
		vi.useFakeTimers();
		vi.resetModules();
		registry.reset();
		registry.installElectronMock();
		tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "morec-share-test-"));
		appSettingsFile = path.join(tempRoot, "app-settings.json");

		vi.doMock("../constants", () => ({
			APP_SETTINGS_FILE: appSettingsFile,
			COUNTDOWN_SETTINGS_FILE: path.join(tempRoot, "countdown.json"),
			RECORDINGS_SETTINGS_FILE: path.join(tempRoot, "recordings.json"),
			SHORTCUTS_FILE: path.join(tempRoot, "shortcuts.json"),
		}));

		const { registerSettingsHandlers } = await import("./settings");
		const { registerShareHandlers } = await import("./share");
		registerSettingsHandlers();
		registerShareHandlers();
	});

	afterEach(async () => {
		vi.useRealTimers();
		vi.resetModules();
		vi.doUnmock("electron");
		vi.doUnmock("../constants");
		await fs.rm(tempRoot, { recursive: true, force: true });
	});

	it("stores the secret encrypted at rest and never hands it back", async () => {
		const stored = await registry.invoke("share:set-secret-key", FIXTURE_SECRET);
		expect(stored).toEqual({ success: true });
		const status = await registry.invoke("share:has-secret-key");
		expect(status).toEqual({ success: true, hasSecretKey: true });

		registry.emitAppEvent("before-quit");
		const raw = await fs.readFile(appSettingsFile, "utf-8");
		expect(raw.includes(FIXTURE_SECRET)).toBe(false);
		const store = JSON.parse(raw) as {
			shareCredentials: { encrypted: string };
		};
		const decoded = Buffer.from(store.shareCredentials.encrypted, "base64").toString(
			"utf-8",
		);
		expect(decoded.startsWith("mock-enc:")).toBe(true);
		expect(decoded).toContain(FIXTURE_SECRET);
	});

	it("rejects empty secrets and clears stored ones", async () => {
		const empty = await registry.invoke("share:set-secret-key", "");
		expect(empty.success).toBe(false);

		await registry.invoke("share:set-secret-key", FIXTURE_SECRET);
		await registry.invoke("share:clear-secret-key");
		const status = await registry.invoke("share:has-secret-key");
		expect(status.hasSecretKey).toBe(false);

		registry.emitAppEvent("before-quit");
		const store = JSON.parse(await fs.readFile(appSettingsFile, "utf-8"));
		expect(store.shareCredentials).toBeNull();
	});

	it("share-upload-recording answers not-configured before any network call", async () => {
		const fetchSpy = vi.spyOn(globalThis, "fetch");
		const result = await registry.invoke("share-upload-recording", {
			filePath: path.join(tempRoot, "video.mp4"),
		});
		expect(result).toMatchObject({ success: false, errorCode: "not-configured" });
		expect(fetchSpy).not.toHaveBeenCalled();
		fetchSpy.mockRestore();
	});
});
