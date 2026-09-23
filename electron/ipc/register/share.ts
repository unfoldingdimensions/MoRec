import { ipcMain } from "electron";
import {
	SHARE_CREDENTIALS_STORE_KEY,
	clearSecret,
	hasSecret,
	isSecretEncryptionAvailable,
	storeSecret,
} from "../ai/credentials";
import { shareUploadRecording, type ShareUploadProgress } from "../share/upload";

/**
 * Sharing handlers: S3 secret-key storage (safeStorage-encrypted, renderer
 * only ever sees a hasSecretKey boolean) and the streaming upload with
 * throttled progress events.
 */

export function registerShareHandlers() {
	ipcMain.handle("share:has-secret-key", () => {
		return { success: true, hasSecretKey: hasSecret(SHARE_CREDENTIALS_STORE_KEY) };
	});

	ipcMain.handle("share:set-secret-key", (_event, secretKey: unknown) => {
		if (typeof secretKey !== "string" || secretKey.trim().length === 0) {
			return { success: false, error: "The secret key must be a non-empty string." };
		}
		if (!isSecretEncryptionAvailable()) {
			return {
				success: false,
				error:
					"Secure credential storage is unavailable on this system, so the key cannot be saved.",
			};
		}
		const stored = storeSecret(SHARE_CREDENTIALS_STORE_KEY, secretKey.trim());
		return stored
			? { success: true }
			: {
					success: false,
					error:
						"Secure credential storage is unavailable on this system, so the key cannot be saved.",
				};
	});

	ipcMain.handle("share:clear-secret-key", () => {
		clearSecret(SHARE_CREDENTIALS_STORE_KEY);
		return { success: true };
	});

	ipcMain.handle(
		"share-upload-recording",
		async (
			event,
			options: { filePath?: string | null },
		) => {
			const sender = event.sender;
			const emitProgress = (progress: ShareUploadProgress) => {
				try {
					if (!sender.isDestroyed()) {
						sender.send("share-upload-progress", progress);
					}
				} catch {
					// Progress delivery is best-effort; never fail the upload for it.
				}
			};

			const result = await shareUploadRecording({
				filePath: typeof options?.filePath === "string" ? options.filePath : "",
				onProgress: emitProgress,
			});
			return result;
		},
	);
}
