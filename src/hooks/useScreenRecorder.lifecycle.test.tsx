// @vitest-environment jsdom
/**
 * Lifecycle tests that exercise the REAL useScreenRecorder hook (not a
 * re-implementation) against a mocked browser recording environment,
 * covering the mid-take error salvage and discard contracts:
 *
 * 1. A MediaRecorder error mid-recording flushes and stops the recorder so
 *    the normal onstop path saves the partial take instead of discarding it.
 * 2. Cancelling a recording never persists the webcam companion file.
 * 3. An error on an already-inactive recorder falls back to the discard path
 *    without attempting a salvage stop.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useScreenRecorder } from "./useScreenRecorder";

vi.mock("@fix-webm-duration/fix", () => ({
	fixWebmDuration: async (blob: Blob) => blob,
}));

type RecordingState = "inactive" | "recording" | "paused";

function createMockTrack(kind: "video" | "audio") {
	return {
		kind,
		readyState: "live" as const,
		label: `mock-${kind}`,
		stop: vi.fn(),
		applyConstraints: vi.fn(async () => undefined),
		getSettings: vi.fn(() =>
			kind === "video"
				? { width: 1920, height: 1080, frameRate: 30 }
				: { sampleRate: 48_000, channelCount: 1 },
		),
		addEventListener: vi.fn(),
		removeEventListener: vi.fn(),
	};
}

function createMockStream(trackKinds: Array<"video" | "audio">) {
	const tracks = trackKinds.map(createMockTrack);
	return {
		getTracks: () => tracks,
		getVideoTracks: () => tracks.filter((track) => track.kind === "video"),
		getAudioTracks: () => tracks.filter((track) => track.kind === "audio"),
		addTrack: vi.fn(),
	};
}

class MockMediaRecorder {
	static instances: MockMediaRecorder[] = [];
	static isTypeSupported = (type: string) => type.startsWith("video/webm");

	mimeType = "video/webm;codecs=vp9";
	state: RecordingState = "inactive";
	ondataavailable: ((event: { data: Blob }) => void) | null = null;
	onstop: (() => void) | null = null;
	onerror: ((event: unknown) => void) | null = null;
	stream: ReturnType<typeof createMockStream>;

	constructor(stream: ReturnType<typeof createMockStream>, _options?: unknown) {
		this.stream = stream;
		MockMediaRecorder.instances.push(this);
	}

	start(_timeslice?: number) {
		this.state = "recording";
	}

	pause() {
		if (this.state === "recording") this.state = "paused";
	}

	resume() {
		if (this.state === "paused") this.state = "recording";
	}

	requestData() {
		this.ondataavailable?.({ data: new Blob(["encoded-chunk"]) });
	}

	stop() {
		if (this.state === "inactive") return;
		this.state = "inactive";
		queueMicrotask(() => this.onstop?.());
	}
}

const TEST_SOURCE = { id: "screen:0", name: "Screen 1", display_id: "0" };

function installElectronApiMock() {
	const electronAPI = {
		getPlatform: vi.fn(async () => "win32"),
		getSelectedSource: vi.fn(async () => TEST_SOURCE),
		getSources: vi.fn(async () => [TEST_SOURCE]),
		isNativeWindowsCaptureAvailable: vi.fn(async () => ({ available: false })),
		getCountdownDelay: vi.fn(async () => ({ success: true, delay: 0 })),
		getRecordingPreferences: vi.fn(async () => ({ success: false })),
		setRecordingPreferences: vi.fn(async () => ({ success: true })),
		setRecordingState: vi.fn(async () => undefined),
		storeRecordedVideo: vi.fn(async () => ({
			success: true,
			path: "/userdata/recordings/recording-1.webm",
		})),
		setCurrentVideoPath: vi.fn(async () => ({ success: true })),
		setCurrentRecordingSession: vi.fn(async () => ({ success: true })),
		switchToEditor: vi.fn(async () => undefined),
		hudOverlayClose: vi.fn(),
		deleteRecordingFile: vi.fn(async () => ({ success: true })),
	};
	(window as unknown as { electronAPI: typeof electronAPI }).electronAPI = electronAPI;
	return electronAPI;
}

function installMediaDeviceMocks() {
	Object.defineProperty(navigator, "mediaDevices", {
		configurable: true,
		value: {
			getUserMedia: vi.fn(async () => createMockStream(["video"])),
			getDisplayMedia: vi.fn(async () => createMockStream(["video"])),
			enumerateDevices: vi.fn(async () => []),
		},
	});
}

interface Harness {
	current: ReturnType<typeof useScreenRecorder>;
	rerender: () => Promise<void>;
	unmount: () => Promise<void>;
}

function renderRecorderHook(): Promise<Harness> {
	let hookResult: ReturnType<typeof useScreenRecorder> | undefined;

	function Probe() {
		hookResult = useScreenRecorder();
		return null;
	}

	const container = document.createElement("div");
	document.body.appendChild(container);
	const root: Root = createRoot(container);

	const rerender = async () => {
		await act(async () => {
			root.render(<Probe />);
		});
	};

	const unmount = async () => {
		await act(async () => {
			root.unmount();
		});
		container.remove();
	};

	const whenReady = act(async () => {
		root.render(<Probe />);
	});

	return (async () => {
		await whenReady;
		return {
			get current() {
				if (!hookResult) throw new Error("hook has not rendered yet");
				return hookResult;
			},
			rerender,
			unmount,
		};
	})();
}

/** The start sequence resolves through several awaited mocked IPCs; a few
 * act-wrapped microtask rounds flush the whole chain deterministically. */
async function flushRecordingPipeline(rounds = 12) {
	for (let i = 0; i < rounds; i += 1) {
		await act(async () => {
			await Promise.resolve();
		});
	}
}

describe("useScreenRecorder lifecycle (browser capture path)", () => {
	let electronAPI: ReturnType<typeof installElectronApiMock>;

	beforeEach(() => {
		vi.clearAllMocks();
		MockMediaRecorder.instances = [];
		electronAPI = installElectronApiMock();
		installMediaDeviceMocks();
		vi.stubGlobal("MediaRecorder", MockMediaRecorder);
		(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
	});

	afterEach(async () => {
		vi.unstubAllGlobals();
	});

	it("starts a browser recording and reaches the recording state", async () => {
		const harness = await renderRecorderHook();

		await act(async () => {
			await harness.current.toggleRecording();
		});
		await flushRecordingPipeline();

		expect(harness.current.recording).toBe(true);
		// One recorder for the screen capture (webcam and mic are disabled).
		expect(MockMediaRecorder.instances).toHaveLength(1);
		expect(MockMediaRecorder.instances[0].state).toBe("recording");

		await harness.unmount();
	});

	it("salvages the partial take when the browser recorder errors mid-recording", async () => {
		const harness = await renderRecorderHook();

		await act(async () => {
			await harness.current.toggleRecording();
		});
		await flushRecordingPipeline();
		const recorder = MockMediaRecorder.instances[0];
		expect(harness.current.recording).toBe(true);

		// Push a chunk, then simulate a fatal encoder error.
		recorder.requestData();
		await act(async () => {
			recorder.onerror?.(new Event("error"));
		});
		await flushRecordingPipeline();

		// The salvage path flushed and stopped the recorder so onstop could
		// save whatever had been encoded instead of discarding the take.
		expect(recorder.state).toBe("inactive");
		expect(electronAPI.storeRecordedVideo).toHaveBeenCalledTimes(1);
		expect(electronAPI.setCurrentVideoPath).toHaveBeenCalledWith(
			"/userdata/recordings/recording-1.webm",
			expect.anything(),
		);
		expect(electronAPI.switchToEditor).toHaveBeenCalledTimes(1);
		expect(electronAPI.hudOverlayClose).toHaveBeenCalled();
		expect(harness.current.finalizing).toBe(false);

		await harness.unmount();
	});

	it("discards the webcam companion file when the recording is cancelled", async () => {
		const harness = await renderRecorderHook();

		// Arm the webcam so a companion recorder is prepared alongside capture.
		await act(async () => {
			harness.current.setWebcamEnabled(true);
		});
		await harness.rerender();

		await act(async () => {
			await harness.current.toggleRecording();
		});
		await flushRecordingPipeline();

		// Webcam recorder is prepared first, then the screen recorder.
		expect(MockMediaRecorder.instances.length).toBe(2);
		expect(harness.current.recording).toBe(true);

		await act(async () => {
			harness.current.cancelRecording();
		});
		await flushRecordingPipeline();

		expect(harness.current.recording).toBe(false);
		expect(electronAPI.setRecordingState).toHaveBeenCalledWith(false);
		// Neither the cancelled screen take nor the webcam companion is stored.
		expect(electronAPI.storeRecordedVideo).not.toHaveBeenCalled();
		for (const recorder of MockMediaRecorder.instances) {
			expect(recorder.state).toBe("inactive");
		}

		await harness.unmount();
	});

	it("falls back to the discard path when an errored recorder is already inactive", async () => {
		const harness = await renderRecorderHook();

		await act(async () => {
			await harness.current.toggleRecording();
		});
		await flushRecordingPipeline();
		const recorder = MockMediaRecorder.instances[0];
		expect(harness.current.recording).toBe(true);

		// The UA already stopped the recorder before the error surfaced.
		recorder.stop();
		await flushRecordingPipeline();
		await act(async () => {
			recorder.onerror?.(new Event("error"));
		});
		await flushRecordingPipeline();

		expect(harness.current.recording).toBe(false);
		expect(electronAPI.storeRecordedVideo).not.toHaveBeenCalled();
		expect(electronAPI.setRecordingState).toHaveBeenCalledWith(false);

		await harness.unmount();
	});
});
