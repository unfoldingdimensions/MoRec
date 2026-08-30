// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/contexts/I18nContext";
import { ThemeProvider } from "@/contexts/ThemeContext";

// The HUD's data + browser-API hooks are mocked at the module boundary; the
// window itself (popovers, control flow, state wiring) renders for real.
const recorder = vi.hoisted(() => ({
	recording: false,
	paused: false,
	finalizing: false,
	countdownActive: false,
	toggleRecording: vi.fn(),
	pauseRecording: vi.fn(),
	resumeRecording: vi.fn(),
	cancelRecording: vi.fn(),
	microphoneEnabled: true,
	setMicrophoneEnabled: vi.fn(),
	microphoneDeviceId: undefined as string | undefined,
	setMicrophoneDeviceId: vi.fn(),
	systemAudioEnabled: true,
	setSystemAudioEnabled: vi.fn(),
	webcamEnabled: false,
	setWebcamEnabled: vi.fn(),
	webcamDeviceId: undefined as string | undefined,
	setWebcamDeviceId: vi.fn(),
	countdownDelay: 0,
	setCountdownDelay: vi.fn(),
	preparePermissions: vi.fn(async () => true),
	isMacOS: false,
}));

const actions = vi.hoisted(() => ({
	selectedSource: null as { id: string; name: string } | null,
	hasSelectedSource: false,
	projectLibraryEntries: [] as never[],
	handleSourceSelect: vi.fn(),
	openVideoFile: vi.fn(async () => undefined),
	openProjectFromLibrary: vi.fn(async () => undefined),
	syncSelectedSource: vi.fn(),
	refreshProjectLibrary: vi.fn(async () => undefined),
}));

const systemState = vi.hoisted(() => ({
	hudOverlayMousePassthroughSupported: true,
	platform: "win32",
	appVersion: "0.2.0",
	hideHudFromCapture: false,
	chooseRecordingsDirectory: vi.fn(async () => undefined),
	toggleHudCaptureProtection: vi.fn(async () => undefined),
}));

const noopFns = vi.hoisted(() => ({
	beginInteractiveHudAction: vi.fn(),
	handleHudMouseEnter: vi.fn(),
	handleHudMouseLeave: vi.fn(),
}));

vi.mock("../../hooks/useScreenRecorder", () => ({
	useScreenRecorder: vi.fn(() => recorder),
}));
vi.mock("../../hooks/useMicrophoneDevices", () => ({
	useMicrophoneDevices: vi.fn(() => ({
		devices: [],
		selectedDeviceId: "default",
		setSelectedDeviceId: vi.fn(),
		isLoading: false,
		error: null,
	})),
}));
vi.mock("../../hooks/useVideoDevices", () => ({
	useVideoDevices: vi.fn(() => ({
		devices: [],
		selectedDeviceId: "default",
		setSelectedDeviceId: vi.fn(),
		isLoading: false,
		error: null,
	})),
}));
vi.mock("./hooks/useLaunchWindowActions", () => ({
	useLaunchWindowActions: vi.fn(() => actions),
}));
vi.mock("./hooks/useLaunchWindowSystemState", () => ({
	useLaunchWindowSystemState: vi.fn(() => systemState),
}));
vi.mock("./hooks/useWebcamPreviewOverlay", () => ({
	useWebcamPreviewOverlay: vi.fn(() => ({
		showFloatingWebcamPreview: false,
		setShowFloatingWebcamPreview: vi.fn(),
		showRecordingWebcamPreview: false,
		webcamPreviewOffset: { x: 0, y: 0 },
		recordingWebcamPreviewContainerRef: { current: null },
		isWebcamPreviewDraggingRef: { current: false },
		webcamPreviewDragStartRef: { current: null },
		handleWebcamPreviewPointerDown: vi.fn(),
		handleWebcamPreviewPointerMove: vi.fn(),
		handleWebcamPreviewPointerUp: vi.fn(),
		setWebcamPreviewNode: vi.fn(),
		setRecordingWebcamPreviewNode: vi.fn(),
	})),
}));
vi.mock("./hooks/useHudBarDrag", () => ({
	useHudBarDrag: vi.fn(() => ({
		recordingHudOffset: { x: 0, y: 0 },
		isHudDragging: false,
		hudBarTransformRef: { current: null },
		isHudDraggingRef: { current: false },
		handleHudBarPointerDown: vi.fn(),
		handleHudBarPointerMove: vi.fn(),
		handleHudBarPointerUp: vi.fn(),
	})),
}));
vi.mock("./hooks/useLaunchHudInteractionState", () => ({
	useLaunchHudInteractionState: vi.fn(() => ({
		handleHudMouseEnter: noopFns.handleHudMouseEnter,
		handleHudMouseLeave: noopFns.handleHudMouseLeave,
		beginInteractiveHudAction: noopFns.beginInteractiveHudAction,
	})),
}));

function installElectronApi() {
	const electronAPI = {
		getSelectedSource: vi.fn(async () => null),
		onSelectedSourceChanged: vi.fn(() => vi.fn()),
		hudOverlaySetWebcamPreviewVisible: vi.fn(),
		hudOverlayHide: vi.fn(),
		hudOverlayClose: vi.fn(),
	};
	(window as unknown as { electronAPI: unknown }).electronAPI = electronAPI;
	return electronAPI;
}

function renderWindow() {
	return render(
		<I18nProvider>
			<ThemeProvider>
				<LaunchWindow />
			</ThemeProvider>
		</I18nProvider>,
	);
}

import { LaunchWindow } from "./LaunchWindow";

describe("LaunchWindow (idle HUD)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		// Reset mutable mock-hook state; clearAllMocks does not touch it.
		recorder.recording = false;
		recorder.paused = false;
		actions.selectedSource = null;
		actions.hasSelectedSource = false;
		installElectronApi();
	});

	it("renders the idle HUD bar with the record button and window actions", async () => {
		renderWindow();

		expect(await screen.findByTitle("Record")).toBeInTheDocument();
		expect(screen.getByTitle(/Close App/i)).toBeInTheDocument();
		expect(screen.getByTitle(/Hide HUD/i)).toBeInTheDocument();
	});

	it("shows the selected source name and starts recording from the record button", async () => {
		actions.selectedSource = "Screen 1";
		actions.hasSelectedSource = true;
		const user = userEvent.setup();
		renderWindow();

		expect((await screen.findAllByText("Screen 1")).length).toBeGreaterThan(0);

		await user.click(screen.getByTitle("Record"));
		expect(recorder.toggleRecording).toHaveBeenCalledTimes(1);
		expect(actions.handleSourceSelect).not.toHaveBeenCalled();
	});

	it("opens the source picker instead of recording when no source is selected", async () => {
		actions.selectedSource = null;
		actions.hasSelectedSource = false;
		const user = userEvent.setup();
		renderWindow();

		await screen.findByTitle(/Record/i);
		await user.click(screen.getByTitle("Record"));

		expect(recorder.toggleRecording).not.toHaveBeenCalled();
		expect(noopFns.beginInteractiveHudAction).toHaveBeenCalledTimes(1);
	});

	it("swaps to the recording controls while recording", async () => {
		recorder.recording = true;
		renderWindow();

		expect(await screen.findByText(/REC/i)).toBeInTheDocument();
		// The idle record button is replaced by the recording controls.
		expect(screen.queryByTitle("Record")).not.toBeInTheDocument();
		expect(screen.getByRole("button", { name: /Stop/i })).toBeInTheDocument();
	});

	it("closes the app from the window close button", async () => {
		const electronAPI = installElectronApi();
		const user = userEvent.setup();
		renderWindow();

		await screen.findByTitle(/Close App/i);
		await user.click(screen.getByTitle(/Close App/i));
		expect(electronAPI.hudOverlayClose).toHaveBeenCalledTimes(1);
	});
});
