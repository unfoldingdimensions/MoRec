import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IpcRegistry } from "../../test/ipcRegistry";

/**
 * Handler-level tests for register/ai.ts: API-key storage must encrypt at
 * rest via safeStorage (verified against the bytes on disk), the renderer
 * only ever receives a hasKey boolean, and summarize-transcript falls back
 * to the heuristic engine when no model is configured.
 *
 * The fixture key is a test-only value; tests assert on the encrypted bytes,
 * never echo the plaintext.
 */
describe("register/ai handlers", () => {
	const registry = new IpcRegistry();
	let tempRoot: string;
	let appSettingsFile: string;
	const FIXTURE_KEY = ["fixture", "key", "not", "real"].join("-");

	beforeEach(async () => {
		vi.useFakeTimers();
		vi.resetModules();
		registry.reset();
		registry.installElectronMock();
		tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "morec-ai-test-"));
		appSettingsFile = path.join(tempRoot, "app-settings.json");

		vi.doMock("../constants", () => ({
			APP_SETTINGS_FILE: appSettingsFile,
			COUNTDOWN_SETTINGS_FILE: path.join(tempRoot, "countdown.json"),
			RECORDINGS_SETTINGS_FILE: path.join(tempRoot, "recordings.json"),
			SHORTCUTS_FILE: path.join(tempRoot, "shortcuts.json"),
		}));

		const { registerSettingsHandlers } = await import("./settings");
		const { registerAiHandlers } = await import("./ai");
		registerSettingsHandlers();
		registerAiHandlers();
	});

	afterEach(async () => {
		vi.useRealTimers();
		vi.resetModules();
		vi.doUnmock("electron");
		vi.doUnmock("../constants");
		await fs.rm(tempRoot, { recursive: true, force: true });
	});

	async function flushAppSettings() {
		registry.emitAppEvent("before-quit");
	}

	it("stores the key encrypted at rest and answers has-key without the plaintext", async () => {
		const stored = await registry.invoke("ai:set-api-key", FIXTURE_KEY);
		expect(stored).toEqual({ success: true });

		const status = await registry.invoke("ai:has-api-key");
		expect(status).toEqual({ success: true, hasKey: true });

		registry.emitAppEvent("before-quit");
		const raw = await fs.readFile(appSettingsFile, "utf-8");
		// The plaintext key must not appear anywhere on disk.
		expect(raw.includes(FIXTURE_KEY)).toBe(false);
		const store = JSON.parse(raw) as {
			aiCredentials: { encrypted: string };
		};
		expect(typeof store.aiCredentials.encrypted).toBe("string");
		// The safeStorage mock wraps plaintext as "mock-enc:<plaintext>"; the
		// persisted form is its base64 encoding, proving the store never keeps
		// the raw value.
		const decoded = Buffer.from(store.aiCredentials.encrypted, "base64").toString(
			"utf-8",
		);
		expect(decoded.startsWith("mock-enc:")).toBe(true);
		expect(decoded).toContain(FIXTURE_KEY);
	});

	it("refuses to store the key when safeStorage encryption is unavailable", async () => {
		const lockedRegistry = new IpcRegistry({
			safeStorage: {
				isEncryptionAvailable: () => false,
			},
		});
		vi.resetModules();
		lockedRegistry.reset();
		lockedRegistry.installElectronMock();
		vi.doMock("../constants", () => ({
			APP_SETTINGS_FILE: appSettingsFile,
			COUNTDOWN_SETTINGS_FILE: path.join(tempRoot, "countdown.json"),
			RECORDINGS_SETTINGS_FILE: path.join(tempRoot, "recordings.json"),
			SHORTCUTS_FILE: path.join(tempRoot, "shortcuts.json"),
		}));
		const { registerSettingsHandlers } = await import("./settings");
		const { registerAiHandlers } = await import("./ai");
		registerSettingsHandlers();
		registerAiHandlers();

		const refused = await lockedRegistry.invoke("ai:set-api-key", FIXTURE_KEY);
		expect(refused.success).toBe(false);
		expect(refused.error).toContain("unavailable");
		const status = await lockedRegistry.invoke("ai:has-api-key");
		expect(status.hasKey).toBe(false);

		vi.doUnmock("../constants");
	});

	it("rejects empty keys and clears stored keys", async () => {
		const empty = await registry.invoke("ai:set-api-key", "   ");
		expect(empty.success).toBe(false);

		await registry.invoke("ai:set-api-key", FIXTURE_KEY);
		const cleared = await registry.invoke("ai:clear-api-key");
		expect(cleared).toEqual({ success: true });
		const status = await registry.invoke("ai:has-api-key");
		expect(status.hasKey).toBe(false);

		const store = await (async () => {
			flushAppSettings();
			return JSON.parse(await fs.readFile(appSettingsFile, "utf-8"));
		})();
		expect(store.aiCredentials).toBeNull();
	});

	it("summarize-transcript falls back to the heuristic engine without a model", async () => {
		const result = await registry.invoke("summarize-transcript", {
			videoPath: null,
			cues: [
				{ startMs: 0, endMs: 2000, text: "Welcome to the demo recording." },
				{ startMs: 2000, endMs: 4000, text: "This tests the fallback path." },
			],
			zoomRegions: [{ startMs: 30_000, endMs: 31_000, depth: 2 }],
			durationMs: 60_000,
		});
		expect(result.success).toBe(true);
		expect(result.engine).toBe("heuristic");
		expect(result.title).toContain("Welcome to the demo recording");
		expect(result.chapters[0].startMs).toBe(0);
	});
});
