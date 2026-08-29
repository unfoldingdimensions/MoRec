import { vi } from "vitest";

/**
 * Factory for a comprehensive `window.electronAPI` mock used by hook and
 * component tests. Every channel resolves with a plausible default; tests
 * override individual channels via the `overrides` map (raw values replace
 * the default vi.fn, so pass `vi.fn(...)` to add assertions).
 */
export type ElectronApiOverrides = Record<string, unknown>;

export function createElectronApiMock(overrides: ElectronApiOverrides = {}) {
	const defaults: Record<string, unknown> = {
		// Platform / environment
		getPlatform: vi.fn(async () => "win32"),
		getSelectedSource: vi.fn(async () => null),
		getSources: vi.fn(async () => []),
		selectSource: vi.fn(async () => ({ success: true })),
		isNativeWindowsCaptureAvailable: vi.fn(async () => ({ available: false })),

		// Preferences / settings
		getRecordingPreferences: vi.fn(async () => ({ success: false })),
		setRecordingPreferences: vi.fn(async () => ({ success: true })),
		getCountdownDelay: vi.fn(async () => ({ success: true, delay: 0 })),
		setCountdownDelay: vi.fn(async () => ({ success: true })),
		startCountdown: vi.fn(async () => ({ success: true })),
		cancelCountdown: vi.fn(async () => ({ success: true })),
		getAppSetting: vi.fn(async () => ({ success: true, value: null })),
		setAppSetting: vi.fn(async () => ({ success: true })),

		// Recording lifecycle
		startNativeScreenRecording: vi.fn(async () => ({ success: false })),
		stopNativeScreenRecording: vi.fn(async () => ({ success: true })),
		pauseNativeScreenRecording: vi.fn(async () => ({ success: true })),
		resumeNativeScreenRecording: vi.fn(async () => ({ success: true })),
		recoverNativeScreenRecording: vi.fn(async () => ({ success: false })),
		setRecordingState: vi.fn(async () => undefined),
		hudOverlaySetSourceSelectionActive: vi.fn(),
		hudOverlayHide: vi.fn(),
		hudOverlayClose: vi.fn(),
		switchToEditor: vi.fn(async () => undefined),

		// File storage
		storeRecordedVideo: vi.fn(async () => ({ success: true, path: "/userdata/recordings/recording-1.webm" })),
		deleteRecordingFile: vi.fn(async () => ({ success: true })),
		setCurrentVideoPath: vi.fn(async () => ({ success: true })),
		setCurrentRecordingSession: vi.fn(async () => ({ success: true })),
		revealInFolder: vi.fn(async () => ({ success: true })),

		// Permissions (macOS)
		getScreenRecordingPermissionStatus: vi.fn(async () => ({ success: true, status: "granted" })),
		getAccessibilityPermissionStatus: vi.fn(async () => ({ success: true, trusted: true })),
		requestAccessibilityPermission: vi.fn(async () => ({ success: true, trusted: true })),
		openScreenRecordingPreferences: vi.fn(async () => undefined),
		openAccessibilityPreferences: vi.fn(async () => undefined),

		// Captions
		getWhisperSmallModelStatus: vi.fn(async () => ({ success: true, exists: true, path: null })),

		// Diagnostics
		getLastNativeCaptureDiagnostics: vi.fn(async () => ({ success: true })),
	};

	const merged: Record<string, unknown> = { ...defaults, ...overrides };
	// Wrap raw override values (non-function) so channel lookups still work.
	for (const [key, value] of Object.entries(overrides)) {
		if (typeof value !== "function") {
			merged[key] = vi.fn(async () => value);
		}
	}

	return merged as unknown as Record<string, ReturnType<typeof vi.fn>>;
}

export function installElectronApiMock(overrides: ElectronApiOverrides = {}) {
	const mock = createElectronApiMock(overrides);
	(window as unknown as { electronAPI: unknown }).electronAPI = mock;
	return mock;
}
