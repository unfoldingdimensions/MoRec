/**
 * Extension IPC Handlers — Main Process
 *
 * Registers IPC handlers for extension management (discover, install,
 * uninstall, enable/disable) and exposes them to the renderer via preload.
 */

import { BrowserWindow, dialog, ipcMain, shell } from "electron";
import type { IpcMainInvokeEvent } from "electron";
import {
	discoverExtensions,
	getExtension,
	getExtensionsDirectory,
	getRegisteredExtensions,
	installExtensionFromPath,
	setExtensionStatus,
	uninstallExtension,
} from "./extensionLoader";
import {
	downloadAndInstallExtension,
	fetchPendingReviews,
	getMarketplaceExtension,
	isTrustedDownloadOrigin,
	searchMarketplace,
	submitExtensionForReview,
	updateReviewStatus,
} from "./extensionMarketplace";
import { getErrorMessage } from "./errorUtils";
import type { ExtensionInfo, MarketplaceReviewStatus } from "./extensionTypes";

/**
 * Serialize extension info for IPC transfer (strip non-serializable fields).
 */
function serializeExtensionInfo(info: ExtensionInfo) {
	return {
		manifest: info.manifest,
		status: info.status,
		path: info.path,
		error: info.error,
		builtin: info.builtin ?? false,
	};
}

// ---------------------------------------------------------------------------
// Consent gating
// ---------------------------------------------------------------------------
// Enabling an extension (and installing one from the marketplace) lets
// third-party code run inside Mo Rec, and both channels are invokable by the
// renderer. Each therefore requires an explicit, cancel-default consent
// dialog, bound to the calling window, before the action is performed.
// ---------------------------------------------------------------------------

/** Result returned to the renderer when a consent dialog is declined. */
const CONSENT_DECLINED = { success: false, reason: "cancelled" } as const;

/** Button index of the cancel action (also the default button + cancelId). */
const CONSENT_CANCEL_BUTTON = 0;

/**
 * Make attacker-influenced text (extension ids, manifest names) safe to
 * interpolate into a native dialog message: collapse whitespace, strip
 * control characters (C0/C1) and bidi override/isolate codepoints, trim,
 * and hard-cap the length so a hostile extension cannot restyle or spoof
 * trusted UI inside the trust-decision dialog.
 */
function sanitizeDialogText(value: unknown, maxLen = 80): string {
	return (
		String(value ?? "")
			.replace(/\s+/g, " ")
			// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping control characters from dialog text is this sanitizer's purpose
			.replace(/[\u0000-\u001F\u007F-\u009F]/g, "")
			// Strip bidi overrides/isolates and zero-width formatting characters
			.replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069]/g, "")
			.trim()
			.slice(0, maxLen)
	);
}

async function confirmExtensionEnable(
	event: IpcMainInvokeEvent,
	ext: ExtensionInfo,
): Promise<boolean> {
	const detailLines = [`Extension ID: ${sanitizeDialogText(ext.manifest.id)}`];
	if (ext.manifest.permissions.length > 0) {
		detailLines.push(`Permissions: ${ext.manifest.permissions.join(", ")}`);
	}
	// Always warn about code execution — even a permissionless manifest runs
	// arbitrary code, so an empty permission list must not read as
	// "no code will run".
	detailLines.push(
		"Enabling lets this extension run code inside Mo Rec. Only enable extensions you trust.",
	);

	const { response } = await dialog.showMessageBox(BrowserWindow.fromWebContents(event.sender)!, {
		type: "warning",
		buttons: ["Cancel", "Enable"],
		defaultId: CONSENT_CANCEL_BUTTON,
		cancelId: CONSENT_CANCEL_BUTTON,
		title: "Enable Extension",
		message: `Enable "${sanitizeDialogText(ext.manifest.name)}"?`,
		detail: detailLines.join("\n\n"),
	});
	return response !== CONSENT_CANCEL_BUTTON;
}

async function confirmMarketplaceInstall(
	event: IpcMainInvokeEvent,
	extensionId: string,
	downloadUrl: string,
): Promise<boolean> {
	let origin = downloadUrl;
	try {
		origin = new URL(downloadUrl).origin;
	} catch {
		// Unreachable: the caller only consults this dialog for parseable,
		// trusted URLs. Fall back to the raw text regardless.
	}

	const { response } = await dialog.showMessageBox(BrowserWindow.fromWebContents(event.sender)!, {
		type: "warning",
		buttons: ["Cancel", "Install"],
		defaultId: CONSENT_CANCEL_BUTTON,
		cancelId: CONSENT_CANCEL_BUTTON,
		title: "Install Extension from Marketplace",
		message: `Install extension "${sanitizeDialogText(extensionId)}"?`,
		detail: `Download source: ${sanitizeDialogText(origin)}\n\nInstalling lets this extension run code inside Mo Rec. Only install extensions you trust.`,
	});
	return response !== CONSENT_CANCEL_BUTTON;
}

/**
 * Register all extension-related IPC handlers.
 * Call this once during app initialization (in main.ts).
 */
export function registerExtensionIpcHandlers(): void {
	// Discover all extensions (builtin + user-installed)
	ipcMain.handle("extensions:discover", async () => {
		const extensions = await discoverExtensions();
		return extensions.map(serializeExtensionInfo);
	});

	// List currently registered extensions
	ipcMain.handle("extensions:list", () => {
		return getRegisteredExtensions().map(serializeExtensionInfo);
	});

	// Get a specific extension by ID
	ipcMain.handle("extensions:get", (_event, id: string) => {
		const ext = getExtension(id);
		return ext ? serializeExtensionInfo(ext) : null;
	});

	// Enable an extension — requires explicit consent: enabling allows the
	// extension's code to run in the renderer.
	ipcMain.handle("extensions:enable", async (event, id: string) => {
		// Unknown ids were never shown to the user — refuse without a dialog.
		const ext = getExtension(id);
		if (!ext) {
			return setExtensionStatus(id, "active");
		}

		if (!(await confirmExtensionEnable(event, ext))) {
			return CONSENT_DECLINED;
		}
		return setExtensionStatus(id, "active");
	});

	// Disable an extension
	ipcMain.handle("extensions:disable", async (_event, id: string) => {
		return setExtensionStatus(id, "disabled");
	});

	// Install an extension from a folder picker
	ipcMain.handle("extensions:install-from-folder", async (event) => {
		const window = BrowserWindow.fromWebContents(event.sender);
		const result = await dialog.showOpenDialog(window!, {
			title: "Select Extension Folder",
			properties: ["openDirectory"],
			message: "Select a folder containing a morec-extension.json manifest",
		});

		if (result.canceled || result.filePaths.length === 0) {
			return { success: false, reason: "cancelled" };
		}

		const info = await installExtensionFromPath(result.filePaths[0]);
		if (!info) {
			return {
				success: false,
				reason: "Invalid extension: missing or invalid morec-extension.json",
			};
		}

		return { success: true, extension: serializeExtensionInfo(info) };
	});

	// Uninstall an extension
	ipcMain.handle("extensions:uninstall", async (_event, id: string) => {
		const success = await uninstallExtension(id);
		return { success };
	});

	// Get extensions directory path
	ipcMain.handle("extensions:get-directory", () => {
		return getExtensionsDirectory();
	});

	// Open extensions directory in file manager
	ipcMain.handle("extensions:open-directory", async () => {
		const dir = getExtensionsDirectory();
		await shell.openPath(dir);
		return { success: true };
	});

	// ── Marketplace ─────────────────────────────────────────────────────

	// Search/browse marketplace
	ipcMain.handle(
		"extensions:marketplace-search",
		async (
			_event,
			params: {
				query?: string;
				tags?: string[];
				sort?: "popular" | "recent" | "rating";
				page?: number;
				pageSize?: number;
			},
		) => {
			try {
				return await searchMarketplace(params);
			} catch (error: unknown) {
				return {
					extensions: [],
					total: 0,
					page: 1,
					pageSize: 20,
					error: getErrorMessage(error),
				};
			}
		},
	);

	// Get a specific marketplace extension
	ipcMain.handle("extensions:marketplace-get", async (_event, id: string) => {
		return getMarketplaceExtension(id);
	});

	// Download and install a marketplace extension — requires explicit consent
	// before anything is downloaded. Untrusted or malformed URLs skip the
	// dialog and are rejected by the downloader's own origin validation.
	ipcMain.handle(
		"extensions:marketplace-install",
		async (event, extensionId: string, downloadUrl: string) => {
			if (
				isTrustedDownloadOrigin(downloadUrl) &&
				!(await confirmMarketplaceInstall(event, extensionId, downloadUrl))
			) {
				return CONSENT_DECLINED;
			}
			return downloadAndInstallExtension(extensionId, downloadUrl);
		},
	);

	// Submit an extension for marketplace review
	ipcMain.handle("extensions:marketplace-submit", async (_event, extensionId: string) => {
		return submitExtensionForReview(extensionId);
	});

	// ── Admin Review System ─────────────────────────────────────────────

	// The admin surface ships disabled: registering it unconditionally would
	// expose marketplace moderation to every renderer. It only exists when the
	// operator configures MOREC_ADMIN_KEY for the environment.
	if (process.env.MOREC_ADMIN_KEY) {
		// Fetch pending reviews (admin only)
		ipcMain.handle(
			"extensions:reviews-list",
			async (
				_event,
				params: {
					status?: MarketplaceReviewStatus;
					page?: number;
					pageSize?: number;
				},
			) => {
				try {
					return await fetchPendingReviews(params);
				} catch (error: unknown) {
					return { reviews: [], total: 0, error: getErrorMessage(error) };
				}
			},
		);

		// Update review status (admin only)
		ipcMain.handle(
			"extensions:review-update",
			async (_event, reviewId: string, status: MarketplaceReviewStatus, notes?: string) => {
				return updateReviewStatus(reviewId, status, notes);
			},
		);
	}
}
