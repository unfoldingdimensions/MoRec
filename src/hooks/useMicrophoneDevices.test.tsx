// @vitest-environment jsdom
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

type MediaDevicesMock = {
	enumerateDevices: ReturnType<typeof vi.fn>;
	getUserMedia: ReturnType<typeof vi.fn>;
	addEventListener: ReturnType<typeof vi.fn>;
	removeEventListener: ReturnType<typeof vi.fn>;
};

function device(partial: { kind: string; deviceId: string; label?: string; groupId?: string }) {
	return { groupId: partial.groupId ?? "group-1", label: partial.label ?? "", ...partial };
}

let mediaDevicesGlobal: MediaDevicesMock;

function installMediaDevices(over: Partial<MediaDevicesMock> = {}): MediaDevicesMock {
	const mediaDevices: MediaDevicesMock = {
		enumerateDevices: vi.fn(async () => []),
		getUserMedia: vi.fn(async () => {
			const track = { stop: vi.fn() };
			return { getTracks: () => [track] } as unknown as MediaStream;
		}),
		addEventListener: vi.fn(),
		removeEventListener: vi.fn(),
		...over,
	};
	Object.defineProperty(navigator, "mediaDevices", {
		configurable: true,
		value: mediaDevices,
	});
	mediaDevicesGlobal = mediaDevices;
	return mediaDevices;
}

async function loadHook() {
	vi.resetModules();
	return (await import("./useMicrophoneDevices")).useMicrophoneDevices;
}

describe("useMicrophoneDevices", () => {
	beforeEach(() => {
		installMediaDevices();
	});

	it("requests label permission for unlabeled devices and stops the probe stream", async () => {
		const probeTrack = { stop: vi.fn() };
		let enumerateCount = 0;
		const mediaDevices = installMediaDevices({
			enumerateDevices: vi.fn(async () => {
				enumerateCount += 1;
				return enumerateCount === 1
					? [
							device({ kind: "audioinput", deviceId: "mic-a" }),
							device({ kind: "audioinput", deviceId: "mic-b" }),
						]
					: [
							device({ kind: "audioinput", deviceId: "mic-a", label: "Blue Yeti" }),
							device({ kind: "audioinput", deviceId: "mic-b", label: "Webcam Mic" }),
						];
			}),
			getUserMedia: vi.fn(async () => ({ getTracks: () => [probeTrack] }) as unknown as MediaStream),
		});
		const useMicrophoneDevices = await loadHook();

		const { result } = renderHook(() => useMicrophoneDevices(true));

		await waitFor(() => {
			expect(result.current.devices.map((d) => d.label)).toEqual(["Blue Yeti", "Webcam Mic"]);
		});
		expect(enumerateCount).toBe(2);
		expect(mediaDevices.getUserMedia).toHaveBeenCalledTimes(1);
		expect(probeTrack.stop).toHaveBeenCalledTimes(1);
	});

	it("lists labeled microphones without requesting permission", async () => {
		const mediaDevices = installMediaDevices({
			enumerateDevices: vi.fn(async () => [
				device({ kind: "audioinput", deviceId: "mic-a", label: "Blue Yeti" }),
				device({ kind: "audioinput", deviceId: "mic-b", label: "Webcam Mic" }),
				device({ kind: "videoinput", deviceId: "cam-1", label: "Camera" }),
			]),
		});
		const useMicrophoneDevices = await loadHook();

		const { result } = renderHook(() => useMicrophoneDevices(true));

		await waitFor(() => {
			expect(result.current.devices).toHaveLength(2);
		});
		expect(result.current.devices.map((d) => d.label)).toEqual(["Blue Yeti", "Webcam Mic"]);
		expect(result.current.selectedDeviceId).toBe("mic-a");
		expect(mediaDevices.getUserMedia).not.toHaveBeenCalled();
	});

	it("surfaces enumeration errors", async () => {
		installMediaDevices({
			enumerateDevices: vi.fn(async () => {
				throw new Error("Enumerator failure");
			}),
		});
		const useMicrophoneDevices = await loadHook();

		const { result } = renderHook(() => useMicrophoneDevices(true));

		await waitFor(() => {
			expect(result.current.error).toBe("Enumerator failure");
		});
		expect(result.current.isLoading).toBe(false);
	});

	it("does not enumerate when disabled", async () => {
		const mediaDevices = installMediaDevices();
		const useMicrophoneDevices = await loadHook();

		renderHook(() => useMicrophoneDevices(false));

		await new Promise((resolve) => setTimeout(resolve, 10));
		expect(mediaDevices.enumerateDevices).not.toHaveBeenCalled();
	});

	it("honors a preferred device id when present", async () => {
		installMediaDevices({
			enumerateDevices: vi.fn(async () => [
				device({ kind: "audioinput", deviceId: "mic-a", label: "Blue Yeti" }),
				device({ kind: "audioinput", deviceId: "mic-b", label: "Webcam Mic" }),
			]),
		});
		const useMicrophoneDevices = await loadHook();

		const { result } = renderHook(() => useMicrophoneDevices(true, "mic-b"));

		await waitFor(() => {
			expect(result.current.selectedDeviceId).toBe("mic-b");
		});
	});

	it("subscribes to devicechange and cleans up on unmount", async () => {
		const mediaDevices = installMediaDevices();
		const useMicrophoneDevices = await loadHook();

		const { unmount } = renderHook(() => useMicrophoneDevices(true));
		await waitFor(() => {
			expect(mediaDevices.addEventListener).toHaveBeenCalledWith(
				"devicechange",
				expect.any(Function),
			);
		});

		unmount();
		expect(mediaDevices.removeEventListener).toHaveBeenCalledWith(
			"devicechange",
			expect.any(Function),
		);
	});

	it("does not re-request label permission on subsequent mounts in the same session", async () => {
		// The first test in this file consumed the once-per-session flag for
		// this module instance; later mounts must enumerate (with labels)
		// without calling getUserMedia again.
		installMediaDevices({
			enumerateDevices: vi.fn(async () => [
				device({ kind: "audioinput", deviceId: "mic-a", label: "Blue Yeti" }),
				device({ kind: "audioinput", deviceId: "mic-b", label: "Webcam Mic" }),
			]),
		});
		const useMicrophoneDevices = await loadHook();

		const first = renderHook(() => useMicrophoneDevices(true));
		await waitFor(() => {
			expect(first.result.current.devices).toHaveLength(2);
		});
		const callsAfterFirstMount = mediaDevicesGlobal.getUserMedia.mock.calls.length;
		first.unmount();

		const second = renderHook(() => useMicrophoneDevices(true));
		await waitFor(() => {
			expect(second.result.current.devices).toHaveLength(2);
		});
		expect(mediaDevicesGlobal.getUserMedia.mock.calls.length).toBe(callsAfterFirstMount);
	});
});
