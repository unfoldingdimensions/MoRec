// @vitest-environment jsdom
import { act } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAudioLevelMeter } from "./useAudioLevelMeter";

class MockAnalyser {
	fftSize = 0;
	smoothingTimeConstant = 0;
	frequencyBinCount = 128;
	getByteFrequencyData = vi.fn((array: Uint8Array) => {
		array.fill(200);
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
		Object.defineProperty(navigator, "mediaDevices", {
			configurable: true,
			value: { getUserMedia },
		});
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		rafCallbacks.length = 0;
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
});
