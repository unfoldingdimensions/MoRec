// @vitest-environment jsdom
import { act } from "react";
import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useRecordingTimer } from "./useRecordingTimer";

describe("useRecordingTimer", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("stays at zero while not recording and resets after a session", () => {
		const { result, rerender } = renderHook(({ recording, paused }) => useRecordingTimer(recording, paused), {
			initialProps: { recording: false, paused: false },
		});

		expect(result.current.elapsed).toBe(0);

		rerender({ recording: true, paused: false });
		act(() => {
			vi.advanceTimersByTime(5000);
		});
		expect(result.current.elapsed).toBe(5);

		rerender({ recording: false, paused: false });
		expect(result.current.elapsed).toBe(0);
	});

	it("does not count paused time toward the elapsed display", () => {
		const { result, rerender } = renderHook(({ recording, paused }) => useRecordingTimer(recording, paused), {
			initialProps: { recording: true, paused: false },
		});

		act(() => {
			vi.advanceTimersByTime(4000);
		});
		expect(result.current.elapsed).toBe(4);

		rerender({ recording: true, paused: true });
		act(() => {
			vi.advanceTimersByTime(30_000);
		});
		expect(result.current.elapsed).toBe(4);

		rerender({ recording: true, paused: false });
		act(() => {
			vi.advanceTimersByTime(2000);
		});
		// The 30 paused seconds are excluded.
		expect(result.current.elapsed).toBe(6);
	});

	it("formats mm:ss with zero padding", () => {
		const { result } = renderHook(() => useRecordingTimer(false, false));

		expect(result.current.formatTime(0)).toBe("00:00");
		expect(result.current.formatTime(65)).toBe("01:05");
		expect(result.current.formatTime(600)).toBe("10:00");
	});
});
