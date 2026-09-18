// @vitest-environment jsdom
import { act } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAudioLevelMeter } from "./useAudioLevelMeter";

let analyserDataValue = 200;

class MockAnalyser {
	fftSize = 0;
	smoothingTimeConstant = 0;
	frequencyBinCount = 128;
	getByteFrequencyData = vi.fn((array: Uint8Array) => {
		array.fill(analyserDataValue);
	});
}

class MockAudioContext {
	static lastAnalyser: MockAnalyser | null = null;
	static instances: MockAudioContext[] = [];

	state = "running";
	resume = vi.fn(async () => undefined);
	close = vi.fn(async () => undefined);
	createAnalyser = vi.fn(() => {
		const analyser = new MockAnalyser();
		MockAudioContext.lastAnalyser = analyser;
		return analyser;
	});
	createMediaStreamSource = vi.fn(() => ({ connect: vi.fn() }));

	constructor() {
		MockAudioContext.instances.push(this);
	}
}

const rafCallbacks: Array<() => void> = [];

describe("useAudioLevelMeter", () => {
	let getUserMedia: ReturnType<typeof vi.fn>;
	let trackStop: ReturnType<typeof vi.fn>;
	let addEventListener: ReturnType<typeof vi.fn>;
	let removeEventListener: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		// A class stub: `new AudioContext()` requires a constructible target.
		vi.stubGlobal("AudioContext", MockAudioContext);
		vi.stubGlobal("requestAnimationFrame", vi.fn((callback: () => void) => {
			rafCallbacks.push(callback);
			return rafCallbacks.length;
		}));
		vi.stubGlobal("cancelAnimationFrame", vi.fn());

		trackStop = vi.fn();
		getUserMedia = vi.fn(async () => ({ getTracks: () => [{ stop: trackStop }] }) as unknown as MediaStream);
		addEventListener = vi.fn();
		removeEventListener = vi.fn();
		Object.defineProperty(navigator, "mediaDevices", {
			configurable: true,
			value: { getUserMedia, addEventListener, removeEventListener },
		});
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		rafCallbacks.length = 0;
		analyserDataValue = 200;
	});

	it("acquires the microphone and derives a normalized level", async () => {
		const { result } = renderHook(() =>
			useAudioLevelMeter({ enabled: true, smoothingFactor: 0.5 }),
		);

		await waitFor(() => {
			expect(result.current.level).toBeGreaterThan(0);
		});
		expect(getUserMedia).toHaveBeenCalledWith({ audio: true, video: false });
		expect(MockAudioContext.lastAnalyser?.smoothingTimeConstant).toBe(0.5);
		// rms(200)/255 * 100 * 2 clamps to the 0-100 range.
		expect(result.current.level).toBe(100);
	});

	it("passes an exact deviceId constraint when one is set", async () => {
		renderHook(() => useAudioLevelMeter({ enabled: true, deviceId: "mic-9" }));

		await waitFor(() => {
			expect(getUserMedia).toHaveBeenCalledWith({
				audio: { deviceId: { exact: "mic-9" } },
				video: false,
			});
		});
	});

	it("stops the stream, closes the context, and cancels the frame loop on disable", async () => {
		const { result, rerender } = renderHook(
			({ enabled }) => useAudioLevelMeter({ enabled }),
			{ initialProps: { enabled: true } },
		);
		await waitFor(() => {
			expect(result.current.level).toBeGreaterThan(0);
		});

		expect(rafCallbacks.length).toBeGreaterThan(0);
		rerender({ enabled: false });

		expect(trackStop).toHaveBeenCalledTimes(1);
		expect(vi.mocked(cancelAnimationFrame)).toHaveBeenCalled();
		expect(result.current.level).toBe(0);
		await waitFor(() => {
			expect(MockAudioContext.instances[0].close).toHaveBeenCalled();
		});
	});

	it("keeps the level at zero when getUserMedia fails", async () => {
		getUserMedia.mockRejectedValue(new Error("denied"));
		const { result } = renderHook(() => useAudioLevelMeter({ enabled: true }));

		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(result.current.level).toBe(0);
	});

	it("loops level updates through requestAnimationFrame", async () => {
		renderHook(() => useAudioLevelMeter({ enabled: true }));
		await waitFor(() => {
			expect(rafCallbacks.length).toBe(1);
		});

		// The scheduled frame re-enqueues itself.
		const frame = rafCallbacks[0];
		act(() => {
			frame();
		});
		expect(rafCallbacks.length).toBe(2);
	});

	it("restarts monitoring when a devicechange fires while enabled", async () => {
		const { result, unmount } = renderHook(() => useAudioLevelMeter({ enabled: true }));
		await waitFor(() => {
			expect(result.current.level).toBeGreaterThan(0);
		});
		const contextCountBefore = MockAudioContext.instances.length;

		const handler = addEventListener.mock.calls.find((call) => call[0] === "devicechange")?.[1] as (() => void) | undefined;
		expect(handler).toBeTypeOf("function");

		// Hot-unplug: tear down the dead graph and open a fresh capture.
		act(() => {
			handler?.();
		});
		await waitFor(() => {
			expect(MockAudioContext.instances.length).toBe(contextCountBefore + 1);
		});
		// The old stream's track was released by the cleanup.
		expect(trackStop).toHaveBeenCalledTimes(1);
		expect(getUserMedia).toHaveBeenCalledTimes(2);

		// Unmount removes the listener and stops the replacement graph too.
		unmount();
		expect(removeEventListener).toHaveBeenCalledWith("devicechange", expect.any(Function));
		expect(trackStop).toHaveBeenCalledTimes(2);
	});

	it("stops replacing the capture graph once disabled", async () => {
		const { rerender } = renderHook(
			({ enabled }) => useAudioLevelMeter({ enabled }),
			{ initialProps: { enabled: true } },
		);
		await waitFor(() => {
			expect(getUserMedia).toHaveBeenCalledTimes(1);
		});

		const handler = addEventListener.mock.calls.find((call) => call[0] === "devicechange")?.[1] as (() => void) | undefined;
		rerender({ enabled: false });
		await waitFor(() => {
			expect(trackStop).toHaveBeenCalledTimes(1);
		});

		act(() => {
			handler?.();
		});
		await new Promise((resolve) => setTimeout(resolve, 10));
		expect(getUserMedia).toHaveBeenCalledTimes(1);
		expect(removeEventListener).toHaveBeenCalledWith("devicechange", expect.any(Function));
	});
});

describe("useAudioLevelMeter pre-flight detection", () => {
	let getUserMedia: ReturnType<typeof vi.fn>;
	let addEventListener: ReturnType<typeof vi.fn>;
	let removeEventListener: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		vi.stubGlobal("AudioContext", MockAudioContext);
		vi.stubGlobal(
			"requestAnimationFrame",
			vi.fn((callback: () => void) => {
				rafCallbacks.push(callback);
				return rafCallbacks.length;
			}),
		);
		vi.stubGlobal("cancelAnimationFrame", vi.fn());

		getUserMedia = vi.fn(
			async () =>
				({ getTracks: () => [{ stop: vi.fn() }] }) as unknown as MediaStream,
		);
		addEventListener = vi.fn();
		removeEventListener = vi.fn();
		Object.defineProperty(navigator, "mediaDevices", {
			configurable: true,
			value: { getUserMedia, addEventListener, removeEventListener },
		});
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		rafCallbacks.length = 0;
		analyserDataValue = 200;
	});

	/** Drives the meter with a constant level, one pump per time step. */
	function pumpFrames(level: number, timeSteps: number[], now: { value: number }) {
		analyserDataValue = level;
		for (const step of timeSteps) {
			now.value = step;
			const frame = rafCallbacks[rafCallbacks.length - 1];
			expect(frame).toBeTypeOf("function");
			act(() => {
				frame();
			});
		}
	}

	it("reports clipping only after the level holds above the threshold", async () => {
		const now = { value: 0 };
		const { result } = renderHook(() =>
			useAudioLevelMeter({
				enabled: true,
				clippingLevel: 97,
				clippingHoldMs: 300,
				now: () => now.value,
			}),
		);
		await waitFor(() => {
			expect(rafCallbacks.length).toBe(1);
		});

		// Sustained max level (the mock fills every bin with 200 -> level 100).
		pumpFrames(200, [150, 300], now);
		expect(result.current.clipping).toBe(true);

		// Dropping below the threshold clears it immediately.
		pumpFrames(0, [400], now);
		expect(result.current.clipping).toBe(false);
	});

	it("does not report clipping for a brief loud burst", async () => {
		const now = { value: 0 };
		const { result } = renderHook(() =>
			useAudioLevelMeter({
				enabled: true,
				clippingLevel: 97,
				clippingHoldMs: 300,
				now: () => now.value,
			}),
		);
		await waitFor(() => {
			expect(rafCallbacks.length).toBe(1);
		});

		pumpFrames(200, [100, 200], now);
		expect(result.current.clipping).toBe(false);
	});

	it("reports no input after sustained silence and clears on any sound", async () => {
		const now = { value: 0 };
		const { result } = renderHook(() =>
			useAudioLevelMeter({
				enabled: true,
				silenceLevel: 2,
				silenceWindowMs: 1000,
				now: () => now.value,
			}),
		);
		await waitFor(() => {
			expect(rafCallbacks.length).toBe(1);
		});

		// Silence for the whole window flips the flag...
		pumpFrames(0, [500, 1000], now);
		expect(result.current.noInput).toBe(true);

		// ...any louder sample clears it, and the window restarts.
		pumpFrames(115, [1100], now);
		expect(result.current.noInput).toBe(false);

		pumpFrames(0, [1500, 2100], now);
		expect(result.current.noInput).toBe(true);
	});

	it("keeps a moderate level from triggering either warning", async () => {
		const now = { value: 0 };
		const { result } = renderHook(() =>
			useAudioLevelMeter({
				enabled: true,
				clippingLevel: 97,
				clippingHoldMs: 300,
				silenceLevel: 2,
				silenceWindowMs: 1000,
				now: () => now.value,
			}),
		);
		await waitFor(() => {
			expect(rafCallbacks.length).toBe(1);
		});

		// Fill 115 -> level ~90: neither silent nor clipping.
		pumpFrames(115, [100, 500, 1000, 2000], now);
		expect(result.current.clipping).toBe(false);
		expect(result.current.noInput).toBe(false);
	});
});
