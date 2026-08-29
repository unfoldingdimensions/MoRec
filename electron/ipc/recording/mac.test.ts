import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setNativeCaptureOutputBuffer, setNativeCaptureTargetPath } from "../state";
import { waitForNativeCaptureStart, waitForNativeCaptureStop } from "./mac";

vi.mock("electron", () => ({
	app: {
		getPath: () => "/tmp/morec-mac-test",
	},
	BrowserWindow: {
		getAllWindows: () => [],
	},
}));

class FakeCaptureProcess extends EventEmitter {
	stdout = new PassThrough();
	stderr = new PassThrough();
	stdin = new PassThrough();
	killed = false;

	kill = vi.fn(() => {
		this.killed = true;
		return true;
	});
}

describe("waitForNativeCaptureStop (macOS)", () => {
	beforeEach(() => {
		setNativeCaptureOutputBuffer("");
		setNativeCaptureTargetPath(null);
	});

	it("resolves the helper output path when the process closes cleanly", async () => {
		const proc = new FakeCaptureProcess();
		setNativeCaptureOutputBuffer("Recording stopped. Output path: /tmp/morec/capture.mp4");

		const stopped = waitForNativeCaptureStop(
			proc as unknown as Parameters<typeof waitForNativeCaptureStop>[0],
		);
		proc.emit("close", 0);

		await expect(stopped).resolves.toBe("/tmp/morec/capture.mp4");
		expect(proc.kill).not.toHaveBeenCalled();
	});

	it("resolves the fallback target path on a clean close without output path", async () => {
		const proc = new FakeCaptureProcess();
		setNativeCaptureOutputBuffer("Recording stopped without an output path");
		setNativeCaptureTargetPath("/tmp/morec/target.mp4");

		const stopped = waitForNativeCaptureStop(
			proc as unknown as Parameters<typeof waitForNativeCaptureStop>[0],
		);
		proc.emit("close", 0);

		await expect(stopped).resolves.toBe("/tmp/morec/target.mp4");
	});

	it("rejects when the helper exits with a nonzero code and no output", async () => {
		const proc = new FakeCaptureProcess();

		const stopped = waitForNativeCaptureStop(
			proc as unknown as Parameters<typeof waitForNativeCaptureStop>[0],
		);
		proc.emit("close", 1);

		await expect(stopped).rejects.toThrow(/exited with code 1/);
	});

	it("rejects when the helper process errors", async () => {
		const proc = new FakeCaptureProcess();

		const stopped = waitForNativeCaptureStop(
			proc as unknown as Parameters<typeof waitForNativeCaptureStop>[0],
		);
		proc.emit("error", new Error("spawn failure"));

		await expect(stopped).rejects.toThrow("spawn failure");
	});

	it("kills a hung helper and rejects after the timeout", async () => {
		vi.useFakeTimers();
		try {
			const proc = new FakeCaptureProcess();

			const stopped = waitForNativeCaptureStop(
				proc as unknown as Parameters<typeof waitForNativeCaptureStop>[0],
				50,
			);
			const expectation = expect(stopped).rejects.toThrow(
				"Timed out waiting for native macOS capture to stop",
			);
			await vi.advanceTimersByTimeAsync(60);
			await expectation;

			expect(proc.kill).toHaveBeenCalledTimes(1);
		} finally {
			vi.useRealTimers();
		}
	});

	it("ignores a late close after the timeout already settled", async () => {
		vi.useFakeTimers();
		try {
			const proc = new FakeCaptureProcess();
			setNativeCaptureOutputBuffer("Recording stopped. Output path: /tmp/late.mp4");

			const stopped = waitForNativeCaptureStop(
				proc as unknown as Parameters<typeof waitForNativeCaptureStop>[0],
				50,
			);
			const expectation = expect(stopped).rejects.toThrow("Timed out");
			await vi.advanceTimersByTimeAsync(60);
			proc.emit("close", 0);
			await expectation;

			// The late close must not crash the process with a second settle.
			expect(proc.killed).toBe(true);
		} finally {
			vi.useRealTimers();
		}
	});
});

describe("waitForNativeCaptureStart (macOS)", () => {
	it("resolves when the helper reports that recording started", async () => {
		const proc = new FakeCaptureProcess();

		const started = waitForNativeCaptureStart(
			proc as unknown as Parameters<typeof waitForNativeCaptureStart>[0],
		);
		proc.stdout.emit("data", Buffer.from("Initializing...\n"));
		proc.stdout.emit("data", Buffer.from("Recording started\n"));

		await expect(started).resolves.toBeUndefined();
	});

	it("rejects if the helper exits before recording starts", async () => {
		const proc = new FakeCaptureProcess();
		setNativeCaptureOutputBuffer("MICROPHONE_CAPTURE_UNAVAILABLE");

		const started = waitForNativeCaptureStart(
			proc as unknown as Parameters<typeof waitForNativeCaptureStart>[0],
		);
		proc.emit("exit", 1);

		await expect(started).rejects.toThrow("MICROPHONE_CAPTURE_UNAVAILABLE");
	});
});
