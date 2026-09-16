import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { downloadWhisperSmallModel, hasWhisperModelMagic } from "./whisper";

vi.mock("electron", () => ({
	app: {
		getPath: (name: string) => `C:\\MoRecTest\\${name}`,
	},
}));

const fsMock = vi.hoisted(() => ({
	mkdir: vi.fn(async () => undefined),
	rm: vi.fn(async () => undefined),
	rename: vi.fn(async () => undefined),
	open: vi.fn(async () => ({
		// readFileMagic passes its own 4-byte buffer; write the magic into it.
		read: async (buffer: Buffer) => {
			buffer.write("ggml", 0, "ascii");
			return { buffer, bytesRead: 4 };
		},
		close: vi.fn(async () => undefined),
	})),
}));

vi.mock("node:fs/promises", () => ({ default: fsMock }));

const httpsGetMock = vi.hoisted(() => vi.fn());
vi.mock("node:https", () => ({ get: httpsGetMock }));

function fakeWebContents() {
	return {
		isDestroyed: () => false,
		send: vi.fn(),
	} as never;
}

/** Serve `totalBytes` as content-length and stream `dataChunks` before ending. */
function serveDownload(totalBytes: number, dataChunks: Buffer[]) {
	httpsGetMock.mockImplementationOnce(
		(_url: string, _options: unknown, callback: (response: unknown) => void) => {
			const response = new EventEmitter() as EventEmitter & {
				statusCode: number;
				headers: Record<string, string>;
				pipe: (dest: EventEmitter) => EventEmitter;
				destroy: (error?: Error) => void;
				resume: () => void;
			};
			response.statusCode = 200;
			response.headers = { "content-length": String(totalBytes) };
			response.pipe = (dest: EventEmitter) => {
				queueMicrotask(() => {
					for (const chunk of dataChunks) {
						response.emit("data", chunk);
					}
					dest.emit("finish");
				});
				return dest;
			};
			response.destroy = () => undefined;
			response.resume = () => undefined;
			queueMicrotask(() => callback(response));
			const request = new EventEmitter() as EventEmitter & { destroy: () => void };
			request.destroy = () => undefined;
			return request;
		},
	);
}

describe("hasWhisperModelMagic", () => {
	it("accepts the shipped ggml container magics", () => {
		expect(hasWhisperModelMagic(Buffer.from("ggml"))).toBe(true);
		expect(hasWhisperModelMagic(Buffer.from("gguf"))).toBe(true);
		expect(hasWhisperModelMagic(Buffer.from("ggmf..."))).toBe(true);
	});

	it("rejects non-model headers and short buffers", () => {
		expect(hasWhisperModelMagic(Buffer.from("<!DOCTYPE html>"))).toBe(false);
		expect(hasWhisperModelMagic(Buffer.from("ggn"))).toBe(false);
		expect(hasWhisperModelMagic(Buffer.alloc(0))).toBe(false);
	});
});

describe("downloadWhisperSmallModel", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("joins an in-flight download instead of starting a second one", async () => {
		serveDownload(20 * 1024 * 1024, [Buffer.alloc(20 * 1024 * 1024)]);
		const first = downloadWhisperSmallModel(fakeWebContents());
		const second = downloadWhisperSmallModel(fakeWebContents());
		await Promise.all([first, second]);

		expect(httpsGetMock).toHaveBeenCalledTimes(1);
		expect(fsMock.rename).toHaveBeenCalledTimes(1);
	});

	it("rejects a truncated download and removes the temp file without renaming", async () => {
		serveDownload(100, [Buffer.alloc(50)]);
		await expect(downloadWhisperSmallModel(fakeWebContents())).rejects.toThrow(
			/incomplete \(50 of 100 bytes\)/,
		);

		expect(fsMock.rename).not.toHaveBeenCalled();
		expect(fsMock.rm).toHaveBeenCalledWith(expect.stringContaining(".download"), {
			force: true,
		});
	});

	it("rejects a download whose header is not a ggml model", async () => {
		fsMock.open.mockResolvedValueOnce({
			read: async (buffer: Buffer) => {
				buffer.write("<!ht", 0, "ascii");
				return { buffer, bytesRead: 4 };
			},
			close: vi.fn(async () => undefined),
		} as never);
		serveDownload(20 * 1024 * 1024, [Buffer.alloc(20 * 1024 * 1024)]);
		await expect(downloadWhisperSmallModel(fakeWebContents())).rejects.toThrow(
			/not a valid ggml model/,
		);

		expect(fsMock.rename).not.toHaveBeenCalled();
	});
});
