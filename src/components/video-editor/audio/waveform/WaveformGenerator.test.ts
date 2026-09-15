import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

class FakeAudioContext {
	decodeAudioData = vi.fn(async () => ({
		numberOfChannels: 1,
		length: 100,
		getChannelData: () => new Float32Array(100),
		duration: 0.01,
		sampleRate: 48_000,
	}));
}

describe("WaveformGenerator source size guard", () => {
	beforeEach(() => {
		vi.stubGlobal("window", { AudioContext: FakeAudioContext });
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	async function makeGenerator() {
		const { WaveformGenerator } = await import("./WaveformGenerator");
		return new WaveformGenerator();
	}

	function fetchRespondingWith(bytes: number) {
		return vi.fn(async () => ({
			ok: true,
			headers: { get: () => String(bytes) },
			arrayBuffer: async () => new ArrayBuffer(Math.min(bytes, 1024)),
		}));
	}

	it("rejects sources beyond the decode budget instead of attempting a decode", async () => {
		const fetchMock = fetchRespondingWith(400 * 1024 * 1024);
		vi.stubGlobal("fetch", fetchMock);
		const generator = await makeGenerator();

		await expect(generator.generate("http://127.0.0.1/video?path=x.wav")).rejects.toThrow(
			/too large to decode/,
		);
	});

	it("still generates peaks for sources within the budget", async () => {
		const fetchMock = fetchRespondingWith(1024);
		vi.stubGlobal("fetch", fetchMock);
		const generator = await makeGenerator();

		const peaks = await generator.generate("http://127.0.0.1/video?path=x.wav");
		expect(peaks.durationMs).toBeGreaterThan(0);
	});
});
