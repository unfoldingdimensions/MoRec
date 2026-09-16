import { ipcMain, shell, systemPreferences } from "electron";
import { normalizeExternalHttpUrl } from "../../navigationPolicy";
import { getMacPrivacySettingsUrl } from "../utils";

export function registerPermissionHandlers() {
	ipcMain.handle("open-external-url", async (_, url: string) => {
		try {
			// Security: only the normalized href of an http(s) URL with a host and
			// no userinfo may reach shell.openExternal — validating the raw
			// renderer string with one parser and opening it with another (the
			// OS shell) lets crafted strings smuggle a different destination.
			const safeUrl = normalizeExternalHttpUrl(url);
			if (!safeUrl) {
				return { success: false, error: "Blocked non-HTTP URL" };
			}
			await shell.openExternal(safeUrl);
			return { success: true };
		} catch (error) {
			console.error("Failed to open URL:", error);
			return { success: false, error: String(error) };
		}
	});

	ipcMain.handle("get-accessibility-permission-status", () => {
		if (process.platform !== "darwin") {
			return { success: true, trusted: true, prompted: false };
		}

		return {
			success: true,
			trusted: systemPreferences.isTrustedAccessibilityClient(false),
			prompted: false,
		};
	});

	ipcMain.handle("request-accessibility-permission", () => {
		if (process.platform !== "darwin") {
			return { success: true, trusted: true, prompted: false };
		}

		return {
			success: true,
			trusted: systemPreferences.isTrustedAccessibilityClient(true),
			prompted: true,
		};
	});

	ipcMain.handle("get-screen-recording-permission-status", () => {
		if (process.platform !== "darwin") {
			return { success: true, status: "granted" };
		}

		try {
			return {
				success: true,
				status: systemPreferences.getMediaAccessStatus("screen"),
			};
		} catch (error) {
			console.error("Failed to get screen recording permission status:", error);
			return { success: false, status: "unknown", error: String(error) };
		}
	});

	ipcMain.handle("open-screen-recording-preferences", async () => {
		if (process.platform !== "darwin") {
			return { success: true };
		}

		try {
			await shell.openExternal(getMacPrivacySettingsUrl("screen"));
			return { success: true };
		} catch (error) {
			console.error("Failed to open Screen Recording preferences:", error);
			return { success: false, error: String(error) };
		}
	});

	ipcMain.handle("open-accessibility-preferences", async () => {
		if (process.platform !== "darwin") {
			return { success: true };
		}

		try {
			await shell.openExternal(getMacPrivacySettingsUrl("accessibility"));
			return { success: true };
		} catch (error) {
			console.error("Failed to open Accessibility preferences:", error);
			return { success: false, error: String(error) };
		}
	});
}
