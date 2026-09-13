// @vitest-environment jsdom
/**
 * Real-hook state-machine tests for useScreenRecorder. These exercise the
 * actual hook (not a re-implementation) against a mocked native-Windows and
 * browser capture environment, pinning the contracts the former replica-based
 * suites in useScreenRecorder.test.ts could not:
 *
 * - R3 finalization ordering: webcam encode → mic sidecar →
 *   muxNativeWindowsRecording → finalizeRecordingSession → hudOverlayClose,
 *   on the stop, recovery, and interruption paths.
 * - R1 cancel cleanup: fallback mic recorder listeners detached, tracks
 *   stopped, chunks cleared, native file deleted, nothing stored.
 * - Pause/resume companion sync gated on the native IPC result.
 * - Browser stop flow edge cases (flush failure, paused stop, no-op stop).
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useScreenRecorder } from "./useScreenRecorder";

vi.mock("@fix-webm-duration/fix", () => ({
	fixWebmDuration: async (blob: Blob) => blob,
}));

vi.mock("sonner", () => ({
	toast: { error: vi.fn(), info: vi.fn(), success: vi.fn(), warning: vi.fn() },
}));

type RecordingState = "inactive" | "recording" | "paused";
type InterruptedHandler = (state: { reason: string; message: string }) => void;

type MockTrack = {
	kind: "video" | "audio";
	readyState: "live" | "ended";
	label: string;
	stop: ReturnType<typeof vi.fn>;
	applyConstraints: ReturnType<typeof vi.fn>;
	getSettings: ReturnType<typeof vi.fn>;
	addEventListener: ReturnType<typeof vi.fn>;
	removeEventListener: ReturnType<typeof vi.fn>;
	fire: (type: string) => void;
};

function createMockTrack(kind: "video" | "audio"): MockTrack {
	const listeners = new Map<string, Array<() => void>>();
	const track: MockTrack = {
		kind,
		readyState: "live",
		label: `mock-${kind}`,
		stop: vi.fn(() => {
			track.readyState = "ended";
		}),
		applyConstraints: vi.fn(async () => undefined),
		getSettings: vi.fn(() =>
			kind === "video"
				? { width: 1920, height: 1080, frameRate: 30 }
				: { sampleRate: 48_000, channelCount: 1 },
		),
		addEventListener: vi.fn((type: string, listener: () => void) => {
			const existing = listeners.get(type) ?? [];
			existing.push(listener);
			listeners.set(type, existing);
		}),
		removeEventListener: vi.fn(),
		fire: (type: string) => {
			for (const listener of listeners.get(type) ?? []) {
				listener();
			}
		},
	};
	return track;
}

type MockStream = {
	tracks: MockTrack[];
	getTracks: () => MockTrack[];
	getVideoTracks: () => MockTrack[];
	getAudioTracks: () => MockTrack[];
	addTrack: ReturnType<typeof vi.fn>;
};

function createMockStream(trackKinds: Array<"video" | "audio">): MockStream {
	const tracks = trackKinds.map(createMockTrack);
	return {
		tracks,
		getTracks: () => tracks,
		getVideoTracks: () => tracks.filter((track) => track.kind === "video"),
		getAudioTracks: () => tracks.filter((track) => track.kind === "audio"),
		addTrack: vi.fn((track: MockTrack) => {
			tracks.push(track);
		}),
	};
}

/** Stand-in for the DOM MediaStream constructor used by the mixing path. */
class MockMediaStreamGlobal {
	tracks: MockTrack[];
	constructor(tracks?: MockTrack[]) {
		this.tracks = tracks ? [...tracks] : [];
	}
	addTrack(track: MockTrack) {
		this.tracks.push(track);
	}
	getTracks() {
		return this.tracks;
	}
	getVideoTracks() {
		return this.tracks.filter((track) => track.kind === "video");
	}
	getAudioTracks() {
		return this.tracks.filter((track) => track.kind === "audio");
	}
}

class MockAudioContext {
	static instances: MockAudioContext[] = [];
	close = vi.fn(async () => undefined);
	createMediaStreamSource = vi.fn(() => ({
		connect: vi.fn((node: unknown) => node),
	}));
	createGain = vi.fn(() => ({
		connect: vi.fn((node: unknown) => node),
		gain: { value: 0 },
	}));
	createMediaStreamDestination = vi.fn(() => ({
		stream: new MockMediaStreamGlobal([createMockTrack("audio")]),
	}));

	constructor() {
		MockAudioContext.instances.push(this);
	}
}

class MockMediaRecorder {
	static instances: MockMediaRecorder[] = [];
	static isTypeSupported = (type: string) => type.startsWith("video/");

	mimeType: string;
	state: RecordingState = "inactive";
	ondataavailable: ((event: { data: Blob }) => void) | null = null;
	onstop: (() => void) | null = null;
	onerror: ((event: unknown) => void) | null = null;
	stream: MockStream;

	constructor(stream: MockStream, options?: { mimeType?: string }) {
		this.stream = stream;
		this.mimeType = options?.mimeType ?? "video/webm;codecs=vp9";
		MockMediaRecorder.instances.push(this);
	}

	start() {
		this.state = "recording";
	}

	pause() {
		if (this.state === "recording") this.state = "paused";
	}

	resume() {
		if (this.state === "paused") this.state = "recording";
	}

	requestData() {
		if (this.state === "inactive") return;
		this.ondataavailable?.({ data: new Blob(["encoded-chunk"]) });
	}

	stop() {
		if (this.state === "inactive") return;
		this.state = "inactive";
		queueMicrotask(() => this.onstop?.());
	}
}

const TEST_SOURCE = { id: "screen:0", name: "Screen 1", display_id: "0" };
const NATIVE_PATH = "/userdata/recordings/recording-1.mp4";
const WEBCAM_PATH = "/userdata/recordings/recording-1-webcam.webm";

type ElectronApiMock = Record<string, unknown>;

function createElectronApiMock(overrides: ElectronApiMock = {}): ElectronApiMock {
	const electronAPI: ElectronApiMock = {
		getPlatform: vi.fn(async () => "win32"),
		getSelectedSource: vi.fn(async () => ({ ...TEST_SOURCE })),
		getSources: vi.fn(async () => [{ ...TEST_SOURCE }]),
		isNativeWindowsCaptureAvailable: vi.fn(async () => ({ available: true })),
		startNativeScreenRecording: vi.fn(async () => ({
			success: true,
			microphoneFallbackRequired: true,
		})),
		stopNativeScreenRecording: vi.fn(async () => ({ success: true, path: NATIVE_PATH })),
		pauseNativeScreenRecording: vi.fn(async () => ({ success: true })),
		resumeNativeScreenRecording: vi.fn(async () => ({ success: true })),
		pauseCursorCapture: vi.fn(async () => undefined),
		resumeCursorCapture: vi.fn(async () => undefined),
		recoverNativeScreenRecording: vi.fn(async () => ({ success: false })),
		muxNativeWindowsRecording: vi.fn(async () => ({ success: true })),
		storeMicrophoneSidecar: vi.fn(async () => ({ success: true })),
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
		hudOverlayClose: vi.fn(async () => undefined),
		deleteRecordingFile: vi.fn(async () => ({ success: true })),
		hideOsCursor: vi.fn(async () => ({ success: true })),
		openSourceSelector: vi.fn(async () => undefined),
		...overrides,
	};
	(window as unknown as { electronAPI: ElectronApiMock }).electronAPI = electronAPI;
	return electronAPI;
}

let gumCalls: MediaStreamConstraints[] = [];
let gumStreams: MockStream[] = [];
let gumImpl: ((constraints: MediaStreamConstraints) => Promise<MockStream>) | null = null;

function installMediaDeviceMocks() {
	gumCalls = [];
	gumStreams = [];
	gumImpl = null;
	Object.defineProperty(navigator, "mediaDevices", {
		configurable: true,
		value: {
			getUserMedia: vi.fn(async (constraints: MediaStreamConstraints) => {
				gumCalls.push(constraints);
				const stream = gumImpl
					? await gumImpl(constraints)
					: await (async () => {
							if (constraints?.audio && !constraints?.video) {
								return createMockStream(["audio"]);
							}
							if (constraints?.audio) return createMockStream(["video", "audio"]);
							return createMockStream(["video"]);
						})();
				gumStreams.push(stream);
				return stream;
			}),
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

async function flushRecordingPipeline(rounds = 16) {
	for (let i = 0; i < rounds; i += 1) {
		await act(async () => {
			await Promise.resolve();
		});
	}
}

async function enablePreference(
	harness: Harness,
	enable: (h: Harness) => void | Promise<void>,
) {
	await act(async () => {
		await enable(harness);
	});
	await harness.rerender();
}

async function startNativeSession(
	harness: Harness,
	options: { webcam?: boolean; micFallback?: boolean } = {},
) {
	if (options.webcam) {
		await enablePreference(harness, (h) => {
			h.current.setWebcamEnabled(true);
		});
	}
	if (options.micFallback) {
		await enablePreference(harness, (h) => {
			h.current.setMicrophoneEnabled(true);
		});
	}
	await act(async () => {
		await harness.current.toggleRecording();
	});
	await flushRecordingPipeline();
	expect(harness.current.recording).toBe(true);
}

async function startBrowserSession(harness: Harness) {
	await act(async () => {
		await harness.current.toggleRecording();
	});
	await flushRecordingPipeline();
	expect(harness.current.recording).toBe(true);
}

function indexOfSequence(callOrder: string[], marker: string) {
	const index = callOrder.indexOf(marker);
	expect(index, `expected "${marker}" in call order`).toBeGreaterThanOrEqual(0);
	return index;
}

describe("useScreenRecorder state machine (real hook, native Windows)", () => {
	let electronAPI: ElectronApiMock;
	let interruptedHandler: InterruptedHandler | null = null;

	beforeEach(() => {
		vi.clearAllMocks();
		MockMediaRecorder.instances = [];
		MockAudioContext.instances = [];
		interruptedHandler = null;
		electronAPI = createElectronApiMock();
		installMediaDeviceMocks();
		vi.stubGlobal("MediaRecorder", MockMediaRecorder);
		vi.stubGlobal("MediaStream", MockMediaStreamGlobal);
		vi.stubGlobal("AudioContext", MockAudioContext);
		window.alert = vi.fn();
		(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
	});

	afterEach(async () => {
		vi.unstubAllGlobals();
	});

	it("starts a native Windows session and reports recording", async () => {
		const harness = await renderRecorderHook();
		await startNativeSession(harness);

		expect(electronAPI.startNativeScreenRecording).toHaveBeenCalledTimes(1);
		expect(electronAPI.startNativeScreenRecording).toHaveBeenCalledWith(
			expect.objectContaining({ id: "screen:0" }),
			expect.objectContaining({
				capturesSystemAudio: false,
				capturesMicrophone: false,
			}),
		);
		expect(electronAPI.setRecordingState).toHaveBeenLastCalledWith(true);

		await harness.unmount();
	});

	it("finalizes with the R3 ordering when no companions are active", async () => {
		const harness = await renderRecorderHook();
		await startNativeSession(harness);

		const callOrder: string[] = [];
		electronAPI.stopNativeScreenRecording = vi.fn(async () => {
			callOrder.push("stop-native");
			return { success: true, path: NATIVE_PATH };
		});
		electronAPI.setRecordingState = vi.fn(async (value: boolean) => {
			callOrder.push(value ? "state-true" : "state-false");
		});
		electronAPI.muxNativeWindowsRecording = vi.fn(async () => {
			callOrder.push("mux");
			return { success: true };
		});
		electronAPI.setCurrentVideoPath = vi.fn(async () => {
			callOrder.push("finalize");
			return { success: true };
		});
		electronAPI.switchToEditor = vi.fn(async () => {
			callOrder.push("switch");
		});
		electronAPI.hudOverlayClose = vi.fn(() => {
			callOrder.push("hud");
		});

		await act(async () => {
			harness.current.stopRecording();
		});
		await flushRecordingPipeline();

		expect(callOrder).toEqual(["stop-native", "state-false", "mux", "finalize", "switch", "hud"]);
		expect(electronAPI.muxNativeWindowsRecording).toHaveBeenCalledWith(expect.any(Number));
		expect(electronAPI.setCurrentVideoPath).toHaveBeenCalledWith(
			NATIVE_PATH,
			expect.objectContaining({ hideOverlayCursorByDefault: false }),
		);
		expect(electronAPI.hudOverlayClose).toHaveBeenCalledTimes(1);
		expect(harness.current.recording).toBe(false);
		expect(harness.current.finalizing).toBe(false);

		await harness.unmount();
	});

	it("awaits the webcam encode before muxing and finalizing (deferred store)", async () => {
		const harness = await renderRecorderHook();
		await startNativeSession(harness, { webcam: true });
		expect(MockMediaRecorder.instances).toHaveLength(1);

		let resolveWebcamStore: (() => void) | null = null;
		electronAPI.storeRecordedVideo = vi.fn(() => {
			callOrder.push("webcam-store");
			return new Promise<{ success: boolean; path: string }>((resolve) => {
				resolveWebcamStore = () => resolve({ success: true, path: WEBCAM_PATH });
			});
		});
		const callOrder: string[] = [];
		electronAPI.stopNativeScreenRecording = vi.fn(async () => {
			callOrder.push("stop-native");
			return { success: true, path: NATIVE_PATH };
		});
		electronAPI.setRecordingState = vi.fn(async (value: boolean) => {
			callOrder.push(value ? "state-true" : "state-false");
		});
		// A stored webcam companion routes session persistence through
		// setCurrentRecordingSession instead of setCurrentVideoPath.
		electronAPI.setCurrentRecordingSession = vi.fn(async () => {
			callOrder.push("finalize");
			return { success: true };
		});
		electronAPI.muxNativeWindowsRecording = vi.fn(async () => {
			callOrder.push("mux");
			return { success: true };
		});
		electronAPI.switchToEditor = vi.fn(async () => {
			callOrder.push("switch");
		});
		electronAPI.hudOverlayClose = vi.fn(() => {
			callOrder.push("hud");
		});

		// Simulate a timeslice chunk so the webcam onstop has something to store.
		MockMediaRecorder.instances[0].requestData();

		await act(async () => {
			harness.current.stopRecording();
		});
		await flushRecordingPipeline();

		// Finalization is blocked until the webcam encode resolves: the webcam
		// store has been invoked (in flight) but nothing downstream has run.
		expect(electronAPI.storeRecordedVideo).toHaveBeenCalledTimes(1);
		expect(callOrder).toEqual(["stop-native", "state-false", "webcam-store"]);
		expect(electronAPI.muxNativeWindowsRecording).not.toHaveBeenCalled();
		expect(electronAPI.hudOverlayClose).not.toHaveBeenCalled();

		await act(async () => {
			resolveWebcamStore?.();
		});
		await flushRecordingPipeline();

		expect(callOrder).toEqual([
			"stop-native",
			"state-false",
			"webcam-store",
			"mux",
			"finalize",
			"switch",
			"hud",
		]);
		expect(electronAPI.setCurrentRecordingSession).toHaveBeenCalledWith(
			expect.objectContaining({
				videoPath: NATIVE_PATH,
				webcamPath: WEBCAM_PATH,
			}),
		);

		await harness.unmount();
	});

	it("stores the mic sidecar before muxing and finalizing (webcam + mic + mux)", async () => {
		const callOrder: string[] = [];
		electronAPI.startNativeScreenRecording = vi.fn(async () => ({
			success: true,
			microphoneFallbackRequired: true,
		}));
		electronAPI.stopNativeScreenRecording = vi.fn(async () => {
			callOrder.push("stop-native");
			return { success: true, path: NATIVE_PATH };
		});
		electronAPI.setRecordingState = vi.fn(async (value: boolean) => {
			callOrder.push(value ? "state-true" : "state-false");
		});
		electronAPI.storeRecordedVideo = vi.fn(async () => {
			callOrder.push("webcam-store");
			return { success: true, path: WEBCAM_PATH };
		});
		electronAPI.storeMicrophoneSidecar = vi.fn(async () => {
			callOrder.push("sidecar");
			return { success: true };
		});
		electronAPI.muxNativeWindowsRecording = vi.fn(async () => {
			callOrder.push("mux");
			return { success: true };
		});
		// A stored webcam companion routes session persistence through
		// setCurrentRecordingSession instead of setCurrentVideoPath.
		electronAPI.setCurrentRecordingSession = vi.fn(async () => {
			callOrder.push("finalize");
			return { success: true };
		});
		electronAPI.switchToEditor = vi.fn(async () => {
			callOrder.push("switch");
		});
		electronAPI.hudOverlayClose = vi.fn(() => {
			callOrder.push("hud");
		});

		const harness = await renderRecorderHook();
		await startNativeSession(harness, { webcam: true, micFallback: true });

		// Webcam recorder first (prepared before capture), mic fallback second.
		expect(MockMediaRecorder.instances).toHaveLength(2);
		const webcamRecorder = MockMediaRecorder.instances[0];
		const micRecorder = MockMediaRecorder.instances[1];
		expect(micRecorder.mimeType).toBe("audio/webm;codecs=opus");
		// Simulate timeslice chunks for both companions.
		webcamRecorder.requestData();
		micRecorder.requestData();

		await act(async () => {
			harness.current.stopRecording();
		});
		await flushRecordingPipeline();

		const stopIdx = indexOfSequence(callOrder, "stop-native");
		const webcamIdx = indexOfSequence(callOrder, "webcam-store");
		const sidecarIdx = indexOfSequence(callOrder, "sidecar");
		const muxIdx = indexOfSequence(callOrder, "mux");
		const finalizeIdx = indexOfSequence(callOrder, "finalize");
		const hudIdx = indexOfSequence(callOrder, "hud");
		expect(webcamIdx).toBeGreaterThan(stopIdx);
		expect(sidecarIdx).toBeGreaterThan(webcamIdx);
		expect(muxIdx).toBeGreaterThan(sidecarIdx);
		expect(finalizeIdx).toBeGreaterThan(muxIdx);
		expect(hudIdx).toBeGreaterThan(finalizeIdx);
		expect(electronAPI.storeMicrophoneSidecar).toHaveBeenCalledWith(
			expect.any(ArrayBuffer),
			NATIVE_PATH,
			expect.objectContaining({ browserMicrophoneProfile: "processed" }),
		);
		for (const recorder of MockMediaRecorder.instances) {
			expect(recorder.state).toBe("inactive");
		}
		// The fallback mic stream tracks are stopped by the sidecar stop path.
		const micTrack = MockMediaRecorder.instances[1].stream.getTracks()[0];
		expect(micTrack.stop).toHaveBeenCalled();

		await harness.unmount();
	});

	it("finalizes without a sidecar when the mic fallback produced no audio", async () => {
		const callOrder: string[] = [];
		electronAPI.startNativeScreenRecording = vi.fn(async () => ({
			success: true,
			microphoneFallbackRequired: true,
		}));
		electronAPI.storeMicrophoneSidecar = vi.fn(async () => {
			callOrder.push("sidecar");
			return { success: true };
		});
		electronAPI.muxNativeWindowsRecording = vi.fn(async () => {
			callOrder.push("mux");
			return { success: true };
		});
		electronAPI.setCurrentVideoPath = vi.fn(async () => {
			callOrder.push("finalize");
			return { success: true };
		});

		const harness = await renderRecorderHook();
		await startNativeSession(harness, { micFallback: true });
		await act(async () => {
			harness.current.stopRecording();
		});
		await flushRecordingPipeline();

		// No chunks were produced, so the sidecar IPC is never invoked.
		expect(callOrder).toEqual(["mux", "finalize"]);
		expect(electronAPI.muxNativeWindowsRecording).toHaveBeenCalledTimes(1);

		await harness.unmount();
	});

	it("recovers the session when the native stop fails (mux → finalize → hud)", async () => {
		const callOrder: string[] = [];
		electronAPI.stopNativeScreenRecording = vi.fn(async () => ({
			success: false,
			error: "helper exited",
		}));
		electronAPI.recoverNativeScreenRecording = vi.fn(async () => {
			callOrder.push("recover");
			return { success: true, path: "/userdata/recordings/recovered.mp4" };
		});
		electronAPI.muxNativeWindowsRecording = vi.fn(async () => {
			callOrder.push("mux");
			return { success: true };
		});
		electronAPI.setCurrentVideoPath = vi.fn(async () => {
			callOrder.push("finalize");
			return { success: true };
		});
		electronAPI.hudOverlayClose = vi.fn(() => {
			callOrder.push("hud");
		});

		const harness = await renderRecorderHook();
		await startNativeSession(harness);
		await act(async () => {
			harness.current.stopRecording();
		});
		await flushRecordingPipeline();

		const recoverIdx = indexOfSequence(callOrder, "recover");
		const muxIdx = indexOfSequence(callOrder, "mux");
		const finalizeIdx = indexOfSequence(callOrder, "finalize");
		const hudIdx = indexOfSequence(callOrder, "hud");
		expect(muxIdx).toBeGreaterThan(recoverIdx);
		expect(finalizeIdx).toBeGreaterThan(muxIdx);
		expect(hudIdx).toBeGreaterThan(finalizeIdx);
		expect(electronAPI.setCurrentVideoPath).toHaveBeenCalledWith(
			"/userdata/recordings/recovered.mp4",
			expect.anything(),
		);
		expect(harness.current.finalizing).toBe(false);

		await harness.unmount();
	});

	it("surfaces failure without finalizing when stop and recovery both fail", async () => {
		electronAPI.stopNativeScreenRecording = vi.fn(async () => ({
			success: false,
			error: "helper exited",
		}));
		electronAPI.recoverNativeScreenRecording = vi.fn(async () => ({ success: false }));

		const harness = await renderRecorderHook();
		await startNativeSession(harness);
		await act(async () => {
			harness.current.stopRecording();
		});
		await flushRecordingPipeline();

		expect(electronAPI.switchToEditor).not.toHaveBeenCalled();
		expect(electronAPI.hudOverlayClose).not.toHaveBeenCalled();
		expect(harness.current.finalizing).toBe(false);
		expect(harness.current.recording).toBe(false);

		await harness.unmount();
	});

	it("deletes the stored webcam companion when stop and recovery both fail", async () => {
		electronAPI.stopNativeScreenRecording = vi.fn(async () => ({
			success: false,
			error: "helper exited",
		}));
		electronAPI.recoverNativeScreenRecording = vi.fn(async () => ({ success: false }));
		electronAPI.storeRecordedVideo = vi.fn(async () => ({
			success: true,
			path: WEBCAM_PATH,
		}));

		const harness = await renderRecorderHook();
		await startNativeSession(harness, { webcam: true });
		MockMediaRecorder.instances[0].requestData();

		await act(async () => {
			harness.current.stopRecording();
		});
		await flushRecordingPipeline();

		// The webcam companion was stored, but no session will ever reference
		// it: the failed-stop path must remove it.
		expect(electronAPI.storeRecordedVideo).toHaveBeenCalledTimes(1);
		expect(electronAPI.deleteRecordingFile).toHaveBeenCalledWith(WEBCAM_PATH);
		expect(electronAPI.switchToEditor).not.toHaveBeenCalled();
		expect(harness.current.finalizing).toBe(false);

		await harness.unmount();
	});

	it("survives session-metadata persistence failure and still closes the HUD", async () => {
		electronAPI.setCurrentVideoPath = vi.fn(async () => {
			throw new Error("persist failed");
		});

		const harness = await renderRecorderHook();
		await startNativeSession(harness);
		await act(async () => {
			harness.current.stopRecording();
		});
		await flushRecordingPipeline();

		// finalizeRecordingSession falls back and swallows the persistence error,
		// then the editor switch runs and the finally-block closes the HUD.
		expect(electronAPI.setCurrentVideoPath).toHaveBeenCalledTimes(2);
		expect(electronAPI.switchToEditor).toHaveBeenCalledTimes(1);
		expect(electronAPI.hudOverlayClose).toHaveBeenCalledTimes(1);
		expect(harness.current.finalizing).toBe(false);

		await harness.unmount();
	});

	it("collapses repeated stop requests into a single native stop", async () => {
		const harness = await renderRecorderHook();
		await startNativeSession(harness);
		await act(async () => {
			harness.current.stopRecording();
			harness.current.stopRecording();
			harness.current.stopRecording();
		});
		await flushRecordingPipeline();

		expect(electronAPI.stopNativeScreenRecording).toHaveBeenCalledTimes(1);
		expect(electronAPI.muxNativeWindowsRecording).toHaveBeenCalledTimes(1);
		expect(electronAPI.setCurrentVideoPath).toHaveBeenCalledTimes(1);
		expect(electronAPI.switchToEditor).toHaveBeenCalledTimes(1);

		await harness.unmount();
	});

	it("completes a stop issued while the session is paused", async () => {
		const harness = await renderRecorderHook();
		await startNativeSession(harness);

		await act(async () => {
			harness.current.pauseRecording();
		});
		await flushRecordingPipeline();
		expect(harness.current.paused).toBe(true);

		await act(async () => {
			harness.current.stopRecording();
		});
		await flushRecordingPipeline();

		expect(electronAPI.stopNativeScreenRecording).toHaveBeenCalledTimes(1);
		expect(electronAPI.setCurrentVideoPath).toHaveBeenCalledWith(NATIVE_PATH, expect.anything());
		expect(electronAPI.hudOverlayClose).toHaveBeenCalledTimes(1);
		expect(harness.current.recording).toBe(false);
		expect(harness.current.paused).toBe(false);

		await harness.unmount();
	});

	it("pauses webcam and mic fallback only after the native pause succeeds", async () => {
		const harness = await renderRecorderHook();
		await startNativeSession(harness, { webcam: true, micFallback: true });
		const webcam = MockMediaRecorder.instances[0];
		const mic = MockMediaRecorder.instances[1];

		await act(async () => {
			harness.current.pauseRecording();
		});
		await flushRecordingPipeline();

		expect(electronAPI.pauseNativeScreenRecording).toHaveBeenCalledTimes(1);
		expect(webcam.state).toBe("paused");
		expect(mic.state).toBe("paused");
		expect(harness.current.paused).toBe(true);
		expect(electronAPI.pauseCursorCapture).toHaveBeenCalledTimes(1);

		await act(async () => {
			harness.current.resumeRecording();
		});
		await flushRecordingPipeline();

		expect(electronAPI.resumeNativeScreenRecording).toHaveBeenCalledTimes(1);
		expect(webcam.state).toBe("recording");
		expect(mic.state).toBe("recording");
		expect(harness.current.paused).toBe(false);
		expect(electronAPI.resumeCursorCapture).toHaveBeenCalledTimes(1);

		await harness.unmount();
	});

	it("leaves companions untouched when the native pause fails", async () => {
		electronAPI.pauseNativeScreenRecording = vi.fn(async () => ({
			success: false,
			error: "backend refused",
		}));

		const harness = await renderRecorderHook();
		await startNativeSession(harness, { webcam: true, micFallback: true });
		const webcam = MockMediaRecorder.instances[0];
		const mic = MockMediaRecorder.instances[1];

		await act(async () => {
			harness.current.pauseRecording();
		});
		await flushRecordingPipeline();

		expect(webcam.state).toBe("recording");
		expect(mic.state).toBe("recording");
		expect(harness.current.paused).toBe(false);

		await harness.unmount();
	});

	it("cancel (R1): stops fallback mic, detaches listeners, stops tracks, deletes the native file", async () => {
		electronAPI.startNativeScreenRecording = vi.fn(async () => ({
			success: true,
			microphoneFallbackRequired: true,
		}));

		const harness = await renderRecorderHook();
		await startNativeSession(harness, { micFallback: true });
		const mic = MockMediaRecorder.instances[0];
		mic.requestData();
		const micTrack = mic.stream.getTracks()[0];

		await act(async () => {
			harness.current.cancelRecording();
		});
		await flushRecordingPipeline();

		expect(mic.state).toBe("inactive");
		expect(mic.ondataavailable).toBeNull();
		expect(mic.onstop).toBeNull();
		expect(mic.onerror).toBeNull();
		expect(micTrack.stop).toHaveBeenCalled();
		expect(micTrack.readyState).toBe("ended");
		expect(electronAPI.stopNativeScreenRecording).toHaveBeenCalledTimes(1);
		expect(electronAPI.deleteRecordingFile).toHaveBeenCalledWith(NATIVE_PATH);
		expect(electronAPI.storeRecordedVideo).not.toHaveBeenCalled();
		expect(electronAPI.storeMicrophoneSidecar).not.toHaveBeenCalled();
		expect(electronAPI.switchToEditor).not.toHaveBeenCalled();
		expect(harness.current.recording).toBe(false);
		expect(harness.current.finalizing).toBe(false);

		await harness.unmount();
	});

	it("cancel (R1): discards the webcam companion and stops its stream", async () => {
		const harness = await renderRecorderHook();
		await startNativeSession(harness, { webcam: true });
		const webcam = MockMediaRecorder.instances[0];
		webcam.requestData();
		const webcamTrack = webcam.stream.getTracks()[0];

		await act(async () => {
			harness.current.cancelRecording();
		});
		await flushRecordingPipeline();

		expect(webcam.state).toBe("inactive");
		expect(webcamTrack.stop).toHaveBeenCalled();
		expect(electronAPI.storeRecordedVideo).not.toHaveBeenCalled();
		expect(electronAPI.deleteRecordingFile).toHaveBeenCalledWith(NATIVE_PATH);
		expect(electronAPI.switchToEditor).not.toHaveBeenCalled();

		await harness.unmount();
	});

	it("cancel while paused clears the pause bookkeeping and tears down", async () => {
		const harness = await renderRecorderHook();
		await startNativeSession(harness, { micFallback: true });
		const mic = MockMediaRecorder.instances[0];

		await act(async () => {
			harness.current.pauseRecording();
		});
		await flushRecordingPipeline();
		expect(harness.current.paused).toBe(true);

		await act(async () => {
			harness.current.cancelRecording();
		});
		await flushRecordingPipeline();

		expect(mic.state).toBe("inactive");
		expect(mic.stream.getTracks()[0].stop).toHaveBeenCalled();
		expect(harness.current.paused).toBe(false);
		expect(harness.current.recording).toBe(false);
		expect(electronAPI.deleteRecordingFile).toHaveBeenCalledWith(NATIVE_PATH);

		await harness.unmount();
	});

	it("does not store the webcam companion after the webcam track ends mid-take", async () => {
		const harness = await renderRecorderHook();
		await startNativeSession(harness, { webcam: true });

		// Unplug the webcam: the track's ended listener fires mid-take.
		const webcamTrack = gumStreams[0].getVideoTracks()[0];
		webcamTrack.fire("ended");
		await flushRecordingPipeline();

		// Keep recording without webcam, then stop normally.
		MockMediaRecorder.instances[0].requestData();
		await act(async () => {
			harness.current.stopRecording();
		});
		await flushRecordingPipeline();

		// The session finalizes without a webcam layer and no orphan file.
		expect(electronAPI.storeRecordedVideo).not.toHaveBeenCalled();
		expect(electronAPI.setCurrentVideoPath).toHaveBeenCalledWith(NATIVE_PATH, expect.anything());
		expect(electronAPI.setCurrentRecordingSession).not.toHaveBeenCalled();
		expect(electronAPI.switchToEditor).toHaveBeenCalledTimes(1);
		expect(electronAPI.hudOverlayClose).toHaveBeenCalledTimes(1);

		await harness.unmount();
	});

	it("recovers with full R3 ordering when the recording is interrupted", async () => {
		electronAPI.onRecordingInterrupted = vi.fn((handler: InterruptedHandler) => {
			interruptedHandler = handler;
			return vi.fn();
		});
		const callOrder: string[] = [];
		electronAPI.recoverNativeScreenRecording = vi.fn(async () => {
			callOrder.push("recover");
			return { success: true, path: "/userdata/recordings/recovered.mp4" };
		});
		electronAPI.storeMicrophoneSidecar = vi.fn(async () => {
			callOrder.push("sidecar");
			return { success: true };
		});
		electronAPI.muxNativeWindowsRecording = vi.fn(async () => {
			callOrder.push("mux");
			return { success: true };
		});
		electronAPI.setCurrentVideoPath = vi.fn(async () => {
			callOrder.push("finalize");
			return { success: true };
		});
		electronAPI.hudOverlayClose = vi.fn(() => {
			callOrder.push("hud");
		});

		const harness = await renderRecorderHook();
		await startNativeSession(harness, { micFallback: true });
		const mic = MockMediaRecorder.instances[0];
		mic.requestData();

		expect(interruptedHandler).toBeTypeOf("function");
		await act(async () => {
			interruptedHandler?.({
				reason: "capture-stopped",
				message: "Recording stopped unexpectedly.",
			});
		});
		await flushRecordingPipeline();

		const sidecarIdx = indexOfSequence(callOrder, "sidecar");
		const muxIdx = indexOfSequence(callOrder, "mux");
		const finalizeIdx = indexOfSequence(callOrder, "finalize");
		const hudIdx = indexOfSequence(callOrder, "hud");
		expect(muxIdx).toBeGreaterThan(sidecarIdx);
		expect(finalizeIdx).toBeGreaterThan(muxIdx);
		expect(hudIdx).toBeGreaterThan(finalizeIdx);
		expect(electronAPI.setCurrentVideoPath).toHaveBeenCalledWith(
			"/userdata/recordings/recovered.mp4",
			expect.anything(),
		);
		// cleanupCapturedMedia ran after recovery: mic tracks are stopped.
		expect(mic.stream.getTracks()[0].stop).toHaveBeenCalled();
		expect(harness.current.recording).toBe(false);
		expect(harness.current.finalizing).toBe(false);

		await harness.unmount();
	});

	it("discards companions and prompts reselection on window-unavailable", async () => {
		electronAPI.onRecordingInterrupted = vi.fn((handler: InterruptedHandler) => {
			interruptedHandler = handler;
			return vi.fn();
		});

		const harness = await renderRecorderHook();
		await startNativeSession(harness, { webcam: true });
		const webcam = MockMediaRecorder.instances[0];
		webcam.requestData();
		const webcamTrack = webcam.stream.getTracks()[0];

		await act(async () => {
			interruptedHandler?.({
				reason: "window-unavailable",
				message: "The selected window is no longer available.",
			});
		});
		await flushRecordingPipeline();

		expect(webcam.state).toBe("inactive");
		expect(webcamTrack.stop).toHaveBeenCalled();
		expect(electronAPI.storeRecordedVideo).not.toHaveBeenCalled();
		expect(electronAPI.recoverNativeScreenRecording).not.toHaveBeenCalled();
		expect(electronAPI.openSourceSelector).toHaveBeenCalledTimes(1);
		expect(window.alert).toHaveBeenCalledWith("The selected window is no longer available.");
		expect(harness.current.recording).toBe(false);

		await harness.unmount();
	});

	it("cleans up without finalizing when interruption recovery fails", async () => {
		electronAPI.onRecordingInterrupted = vi.fn((handler: InterruptedHandler) => {
			interruptedHandler = handler;
			return vi.fn();
		});
		electronAPI.recoverNativeScreenRecording = vi.fn(async () => ({ success: false }));
		electronAPI.storeRecordedVideo = vi.fn(async () => ({
			success: true,
			path: WEBCAM_PATH,
		}));

		const harness = await renderRecorderHook();
		await startNativeSession(harness, { webcam: true });
		const webcam = MockMediaRecorder.instances[0];
		webcam.requestData();

		await act(async () => {
			interruptedHandler?.({
				reason: "capture-stopped",
				message: "Recording stopped unexpectedly.",
			});
		});
		await flushRecordingPipeline();

		// The webcam companion was stored but has no parent session: deleted.
		expect(electronAPI.storeRecordedVideo).toHaveBeenCalledTimes(1);
		expect(electronAPI.deleteRecordingFile).toHaveBeenCalledWith(WEBCAM_PATH);
		expect(electronAPI.switchToEditor).not.toHaveBeenCalled();
		expect(electronAPI.hudOverlayClose).not.toHaveBeenCalled();
		expect(harness.current.finalizing).toBe(false);

		await harness.unmount();
	});
});

describe("useScreenRecorder state machine (real hook, browser capture)", () => {
	let electronAPI: ElectronApiMock;

	function useBrowserCapture() {
		electronAPI.isNativeWindowsCaptureAvailable = vi.fn(async () => ({ available: false }));
	}

	beforeEach(() => {
		vi.clearAllMocks();
		MockMediaRecorder.instances = [];
		MockAudioContext.instances = [];
		electronAPI = createElectronApiMock();
		installMediaDeviceMocks();
		vi.stubGlobal("MediaRecorder", MockMediaRecorder);
		vi.stubGlobal("MediaStream", MockMediaStreamGlobal);
		vi.stubGlobal("AudioContext", MockAudioContext);
		window.alert = vi.fn();
		(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
	});

	afterEach(async () => {
		vi.unstubAllGlobals();
	});

	it("saves the take through the normal stop flow (flush → store → finalize → hud)", async () => {
		useBrowserCapture();
		const callOrder: string[] = [];
		electronAPI.storeRecordedVideo = vi.fn(async () => {
			callOrder.push("store");
			return { success: true, path: "/userdata/recordings/recording-1.webm" };
		});
		electronAPI.setCurrentVideoPath = vi.fn(async () => {
			callOrder.push("finalize");
			return { success: true };
		});
		electronAPI.switchToEditor = vi.fn(async () => {
			callOrder.push("switch");
		});
		electronAPI.hudOverlayClose = vi.fn(() => {
			callOrder.push("hud");
		});

		const harness = await renderRecorderHook();
		await startBrowserSession(harness);
		const recorder = MockMediaRecorder.instances[0];
		recorder.requestData();

		await act(async () => {
			harness.current.stopRecording();
		});
		await flushRecordingPipeline();

		expect(callOrder).toEqual(["store", "finalize", "switch", "hud"]);
		expect(electronAPI.setRecordingState).toHaveBeenLastCalledWith(false);
		expect(harness.current.finalizing).toBe(false);

		await harness.unmount();
	});

	it("still stops the recorder when the explicit flush fails", async () => {
		useBrowserCapture();
		const harness = await renderRecorderHook();
		await startBrowserSession(harness);
		const recorder = MockMediaRecorder.instances[0];
		recorder.requestData = vi.fn(() => {
			throw new Error("flush failed");
		});

		await act(async () => {
			harness.current.stopRecording();
		});
		await flushRecordingPipeline();

		expect(recorder.state).toBe("inactive");
		// No flushed chunk means nothing to save; the empty-take path runs.
		expect(electronAPI.storeRecordedVideo).not.toHaveBeenCalled();
		expect(harness.current.finalizing).toBe(false);

		await harness.unmount();
	});

	it("resumes a paused browser recording before stopping it", async () => {
		useBrowserCapture();
		const harness = await renderRecorderHook();
		await startBrowserSession(harness);
		const recorder = MockMediaRecorder.instances[0];
		const resumeSpy = vi.spyOn(recorder, "resume");

		await act(async () => {
			harness.current.pauseRecording();
		});
		await flushRecordingPipeline();
		expect(harness.current.paused).toBe(true);
		expect(recorder.state).toBe("paused");

		await act(async () => {
			harness.current.stopRecording();
		});
		await flushRecordingPipeline();

		expect(resumeSpy).toHaveBeenCalled();
		expect(electronAPI.storeRecordedVideo).toHaveBeenCalledTimes(1);
		expect(electronAPI.hudOverlayClose).toHaveBeenCalledTimes(1);

		await harness.unmount();
	});

	it("does nothing when the browser recorder is already inactive", async () => {
		useBrowserCapture();
		const harness = await renderRecorderHook();
		await startBrowserSession(harness);
		const recorder = MockMediaRecorder.instances[0];

		await act(async () => {
			recorder.stop();
		});
		await flushRecordingPipeline();

		await act(async () => {
			harness.current.stopRecording();
		});
		await flushRecordingPipeline();

		expect(electronAPI.storeRecordedVideo).not.toHaveBeenCalled();
		expect(electronAPI.setCurrentVideoPath).not.toHaveBeenCalled();
		expect(electronAPI.switchToEditor).not.toHaveBeenCalled();

		await harness.unmount();
	});

	it("cancel (R1): tears down mic stream, mixing context, and all tracks without storing", async () => {
		useBrowserCapture();

		const harness = await renderRecorderHook();
		await enablePreference(harness, (h) => {
			h.current.setMicrophoneEnabled(true);
			h.current.setSystemAudioEnabled(true);
		});
		await act(async () => {
			await harness.current.toggleRecording();
		});
		await flushRecordingPipeline();
		expect(harness.current.recording).toBe(true);

		// One screen recorder; the mic is mixed into the screen stream, not recorded.
		expect(MockMediaRecorder.instances).toHaveLength(1);
		expect(gumCalls).toHaveLength(2);
		const screenStream = gumStreams[0];
		const micStream = gumStreams[1];

		const recorder = MockMediaRecorder.instances[0];
		await act(async () => {
			harness.current.cancelRecording();
		});
		await flushRecordingPipeline();

		expect(recorder.state).toBe("inactive");
		expect(recorder.onstop).toBeNull();
		for (const track of [...screenStream.getTracks(), ...micStream.getTracks()]) {
			expect(track.stop).toHaveBeenCalled();
		}
		expect(MockAudioContext.instances[0].close).toHaveBeenCalled();
		expect(electronAPI.storeRecordedVideo).not.toHaveBeenCalled();
		expect(harness.current.recording).toBe(false);

		await harness.unmount();
	});
});
