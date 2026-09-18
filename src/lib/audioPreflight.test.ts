// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import {
	detectSilentSystemAudio,
	shouldWarnSilentSystemAudio,
	type CompanionAudioLevelSnapshot,
} from "./audioPreflight";

function level(overrides: Partial<CompanionAudioLevelSnapshot>): CompanionAudioLevelSnapshot {
	return {
		path: "/r/recording.system.wav",
		kind: "system",
		maxVolumeDb: -12,
		meanVolumeDb: -30,
		...overrides,
	};
}

describe("shouldWarnSilentSystemAudio", () => {
	it("warns when system audio was requested but recorded silence", () => {
		expect(
			shouldWarnSilentSystemAudio({
				levels: [level({ maxVolumeDb: -91.5 })],
				systemAudioEnabled: true,
			}),
		).toBe(true);
	});

	it("stays quiet when the system track has real signal", () => {
		expect(
			shouldWarnSilentSystemAudio({
				levels: [level({ maxVolumeDb: -12 })],
				systemAudioEnabled: true,
			}),
		).toBe(false);
	});

	it("stays quiet when system audio was not requested", () => {
		expect(
			shouldWarnSilentSystemAudio({
				levels: [level({ maxVolumeDb: -91.5 })],
				systemAudioEnabled: false,
			}),
		).toBe(false);
	});

	it("stays quiet when no system companion exists (mic-only recording)", () => {
		expect(
			shouldWarnSilentSystemAudio({
				levels: [level({ kind: "mic", path: "/r/recording.mic.wav" })],
				systemAudioEnabled: true,
			}),
		).toBe(false);
		expect(shouldWarnSilentSystemAudio({ levels: [], systemAudioEnabled: true })).toBe(
			false,
		);
	});

	it("treats an unmeasurable system track as not-silent (no false alarm)", () => {
		expect(
			shouldWarnSilentSystemAudio({
				levels: [level({ maxVolumeDb: null })],
				systemAudioEnabled: true,
			}),
		).toBe(false);
	});
});

describe("detectSilentSystemAudio", () => {
	it("skips the IPC call entirely when system audio is off", async () => {
		window.electronAPI = {
			analyzeCompanionAudioLevels: vi.fn(),
		} as unknown as typeof window.electronAPI;

		await expect(
			detectSilentSystemAudio("/r/recording.mp4", false),
		).resolves.toBe(false);
		expect(window.electronAPI.analyzeCompanionAudioLevels).not.toHaveBeenCalled();
	});

	it("maps a silent probe result to a warning", async () => {
		window.electronAPI = {
			analyzeCompanionAudioLevels: vi.fn(async () => ({
				success: true,
				levels: [
					{
						path: "/r/recording.system.wav",
						kind: "system" as const,
						maxVolumeDb: -92,
						meanVolumeDb: -95,
					},
				],
			})),
		} as unknown as typeof window.electronAPI;

		await expect(detectSilentSystemAudio("/r/recording.mp4", true)).resolves.toBe(
			true,
		);
	});

	it("survives IPC failures without warning", async () => {
		window.electronAPI = {
			analyzeCompanionAudioLevels: vi.fn(async () => {
				throw new Error("ipc down");
			}),
		} as unknown as typeof window.electronAPI;

		await expect(detectSilentSystemAudio("/r/recording.mp4", true)).resolves.toBe(
			false,
		);
	});
});
