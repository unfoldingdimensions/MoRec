import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import { IpcRegistry } from "../../test/ipcRegistry";

/**
 * Handler-level tests for `register/permissions.ts`: the open-external-url
 * channel must only ever hand the NORMALIZED href of an http(s) URL without
 * userinfo to shell.openExternal — raw renderer strings (file:, javascript:,
 * userinfo tricks) must be rejected without opening anything.
 */
describe("register/permissions handlers", () => {
	const registry = new IpcRegistry();

	beforeEach(async () => {
		vi.resetModules();
		registry.reset();
		registry.installElectronMock();

		const { registerPermissionHandlers } = await import("./permissions");
		registerPermissionHandlers();
	});

	afterEach(async () => {
		vi.resetModules();
		vi.doUnmock("electron");
	});

	async function openExternalMock(): Promise<Mock> {
		const { shell } = await import("electron");
		return shell.openExternal as unknown as Mock;
	}

	it("opens the normalized href for a plain https URL", async () => {
		const openExternal = await openExternalMock();

		const result = await registry.invoke("open-external-url", "https://example.com");

		expect(result).toEqual({ success: true });
		expect(openExternal).toHaveBeenCalledTimes(1);
		// The normalized href (trailing slash added), never the raw string.
		expect(openExternal.mock.calls[0][0]).toBe("https://example.com/");
	});

	it("rejects file: and javascript: URLs without opening anything", async () => {
		const openExternal = await openExternalMock();

		const fileResult = (await registry.invoke(
			"open-external-url",
			"file:///C:/Windows/win.ini",
		)) as { success: boolean; error?: string };
		expect(fileResult.success).toBe(false);
		expect(fileResult.error).toBe("Blocked non-HTTP URL");

		const jsResult = (await registry.invoke(
			"open-external-url",
			"javascript:alert(document.domain)",
		)) as { success: boolean; error?: string };
		expect(jsResult.success).toBe(false);
		expect(jsResult.error).toBe("Blocked non-HTTP URL");

		expect(openExternal).not.toHaveBeenCalled();
	});

	it("rejects userinfo URLs instead of normalizing past them", async () => {
		const openExternal = await openExternalMock();

		const result = await registry.invoke(
			"open-external-url",
			"https://evil.com\u0020@good.example/",
		);

		expect(result).toEqual({ success: false, error: "Blocked non-HTTP URL" });
		expect(openExternal).not.toHaveBeenCalled();
	});
});
