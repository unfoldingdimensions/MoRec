// @vitest-environment jsdom
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

type MediaDevicesMock = {
	enumerateDevices: ReturnType<typeof vi.fn>;
	getUserMedia: ReturnType<typeof vi.fn>;
	addEventListener: ReturnType<typeof vi.fn>;
	removeEventListener: ReturnType<typeof vi.fn>;
};

function device(partial: { kind: string; deviceId: string; label?: string }) {
	return { groupId: "group-1", label: "", ...partial };
}

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
	return mediaDevices;
}

async function loadHook() {
	vi.resetModules();
	return (await import("./useVideoDevices")).useVideoDevices;
}

describe("useVideoDevices", () => {
	beforeEach(() => {
		installMediaDevices();
	});

	it("lists labeled cameras and selects the first one", async () => {
		installMediaDevices({
			enumerateDevices: vi.fn(async () => [
				device({ kind: "videoinput", deviceId: "cam-1", label: "FaceTime HD" }),
				device({ kind: "videoinput", deviceId: "cam-2", label: "External Cam" }),
				device({ kind: "audioinput", deviceId: "mic-1", label: "Mic" }),
			]),
		});
		const useVideoDevices = await loadHook();

		const { result } = renderHook(() => useVideoDevices(true));

		await waitFor(() => {
			expect(result.current.devices).toHaveLength(2);
		});
		expect(result.current.devices.map((d) => d.label)).toEqual(["FaceTime HD", "External Cam"]);
		expect(result.current.selectedDeviceId).toBe("cam-1");
	});

	it("falls back to generated camera labels for unlabeled devices", async () => {
		installMediaDevices({
			enumerateDevices: vi.fn(async () => [
				device({ kind: "videoinput", deviceId: "cam-1" }),
				device({ kind: "videoinput", deviceId: "cam-2" }),
			]),
		});
		const useVideoDevices = await loadHook();

		const { result } = renderHook(() => useVideoDevices(true));

		await waitFor(() => {
			expect(result.current.devices.map((d) => d.label)).toEqual(["Camera 1", "Camera 2"]);
		});
	});

	it("starts with the preferred device id selected", async () => {
		installMediaDevices({
			enumerateDevices: vi.fn(async () => [
				device({ kind: "videoinput", deviceId: "cam-1", label: "FaceTime HD" }),
				device({ kind: "videoinput", deviceId: "cam-2", label: "External Cam" }),
			]),
		});
		const useVideoDevices = await loadHook();

		const { result } = renderHook(() => useVideoDevices(true, "cam-2"));

		expect(result.current.selectedDeviceId).toBe("cam-2");
		await waitFor(() => {
			expect(result.current.devices).toHaveLength(2);
		});
		expect(result.current.selectedDeviceId).toBe("cam-2");
	});

	it("surfaces enumeration errors", async () => {
		installMediaDevices({
			enumerateDevices: vi.fn(async () => {
				throw new Error("No video devices");
			}),
		});
		const useVideoDevices = await loadHook();

		const { result } = renderHook(() => useVideoDevices(true));

		await waitFor(() => {
			expect(result.current.error).toBe("No video devices");
		});
	});

	it("retries the label probe after a transient failure", async () => {
		let probeAttempts = 0;
		const mediaDevices = installMediaDevices({
			enumerateDevices: vi.fn(async () => {
				return probeAttempts >= 2
					? [device({ kind: "videoinput", deviceId: "cam-1", label: "FaceTime HD" })]
					: [device({ kind: "videoinput", deviceId: "cam-1" })];
			}),
			getUserMedia: vi.fn(async () => {
				probeAttempts += 1;
				if (probeAttempts === 1) {
					const error = new Error("Device is busy");
					error.name = "NotReadableError";
					throw error;
				}
				const track = { stop: vi.fn() };
				return { getTracks: () => [track] } as unknown as MediaStream;
			}),
		});
		const useVideoDevices = await loadHook();

		const { result } = renderHook(() => useVideoDevices(true));
		await waitFor(() => {
			expect(result.current.error).toBe("Device is busy");
		});

		const deviceChangeHandler = mediaDevices.addEventListener.mock.calls.find(
			(call) => call[0] === "devicechange",
		)?.[1] as () => void;
		deviceChangeHandler();

		await waitFor(() => {
			expect(result.current.devices.map((d) => d.label)).toEqual(["FaceTime HD"]);
		});
		expect(probeAttempts).toBe(2);
	});

	it("does not re-request the label probe after a denial", async () => {
		const mediaDevices = installMediaDevices({
			enumerateDevices: vi.fn(async () => [device({ kind: "videoinput", deviceId: "cam-1" })]),
			getUserMedia: vi.fn(async () => {
				throw new DOMException("Permission denied", "NotAllowedError");
			}),
		});
		const useVideoDevices = await loadHook();

		const { result } = renderHook(() => useVideoDevices(true));
		await waitFor(() => {
			expect(result.current.error).not.toBeNull();
		});
		expect(mediaDevices.getUserMedia).toHaveBeenCalledTimes(1);

		const deviceChangeHandler = mediaDevices.addEventListener.mock.calls.find(
			(call) => call[0] === "devicechange",
		)?.[1] as () => void;
		deviceChangeHandler();
		await new Promise((resolve) => setTimeout(resolve, 10));

		expect(mediaDevices.getUserMedia).toHaveBeenCalledTimes(1);
	});
});
