import { safeStorage } from "electron";
import { readAppSettingValue, writeAppSettingValue } from "../register/settings";

/**
 * Credential store for BYO secrets (AI API key, S3 secret key).
 *
 * Secrets are encrypted with Electron safeStorage in the main process and
 * persisted as base64 under a dedicated app-settings key. The plaintext
 * secret never leaves this module except to the feature code that needs it
 * (the summarize handler, the upload signer); it is never returned over IPC,
 * never logged, and never included in error messages. The renderer only ever
 * learns a boolean "a key is stored".
 *
 * Reads/writes go through the register/settings store accessors so secrets
 * share the same in-memory cache and debounced persistence as every other
 * app setting — a direct file write here could be clobbered by the cache.
 */

export const AI_CREDENTIALS_STORE_KEY = "aiCredentials";
export const SHARE_CREDENTIALS_STORE_KEY = "shareCredentials";

export function isSecretEncryptionAvailable(): boolean {
	try {
		return safeStorage.isEncryptionAvailable();
	} catch {
		return false;
	}
}

export function storeSecret(storeKey: string, secret: string): boolean {
	if (!isSecretEncryptionAvailable()) {
		return false;
	}
	const encrypted = safeStorage.encryptString(secret);
	writeAppSettingValue(storeKey, { encrypted: encrypted.toString("base64") });
	return true;
}

export function hasSecret(storeKey: string): boolean {
	const entry = readAppSettingValue(storeKey);
	return (
		typeof entry === "object" &&
		entry !== null &&
		typeof (entry as { encrypted?: unknown }).encrypted === "string" &&
		((entry as { encrypted: string }).encrypted.length > 0)
	);
}

/** Main-process only: decrypts the stored secret. Throws when absent/unreadable. */
export function loadSecret(storeKey: string): string {
	const entry = readAppSettingValue(storeKey);
	if (typeof entry !== "object" || entry === null) {
		throw new Error("No credential is stored for this feature.");
	}
	const encrypted = (entry as { encrypted?: unknown }).encrypted;
	if (typeof encrypted !== "string" || encrypted.length === 0) {
		throw new Error("No credential is stored for this feature.");
	}
	if (!isSecretEncryptionAvailable()) {
		throw new Error("Credential decryption is unavailable on this system.");
	}
	return safeStorage.decryptString(Buffer.from(encrypted, "base64"));
}

export function clearSecret(storeKey: string): void {
	writeAppSettingValue(storeKey, null);
}

/**
 * Best-effort scrubbing of credential material from arbitrary text (error
 * strings shown to the user). Called on every error path that could carry
 * configured values (endpoint URLs, headers echoed by a server, etc.).
 */
export function redactCredentials(
	message: string,
	secrets: Array<string | undefined | null>,
): string {
	let redacted = message;
	for (const secret of secrets) {
		if (!secret || secret.length < 4) {
			continue;
		}
		redacted = redacted.split(secret).join("[redacted]");
	}
	return redacted;
}
