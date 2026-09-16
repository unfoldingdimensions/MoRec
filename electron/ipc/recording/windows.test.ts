import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import {
	setWindowsCaptureOutputBuffer,
	setWindowsCaptureStopRequested,
	setWindowsCaptureTargetPath,
	setWindowsCaptureTempPath,
	setWindowsMicAudioPath,
	setWindowsNativeCaptureActive,
	setWindowsSystemAudioPath,
	windowsMicAudioPath,
	windowsSystemAudioPath,
} from "../state";
import { attachWindowsCaptureLifecycle, waitForWindowsCaptureStop } from "./windows";

vi.mock("electron", () => ({
	app: {
		getPath: () => "C:\\MoRecTest",
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

describe("waitForWindowsCaptureStop", () => {
	beforeEach(() => {
		setWindowsCaptureOutputBuffer("");
		setWindowsCaptureTargetPath(null);
	});

	it("resolves the helper output path when the process closes cleanly", async () => {
		const proc = new FakeCaptureProcess();
		setWindowsCaptureOutputBuffer("Recording stopped. Output path: C:\\MoRec\\capture.mp4");

		const stopped = waitForWindowsCaptureStop(
			proc as unknown as Parameters<typeof waitForWindowsCaptureStop>[0],
			1000,
		);
		proc.emit("close", 0);

		await expect(stopped).resolves.toBe("C:\\MoRec\\capture.mp4");
		expect(proc.kill).not.toHaveBeenCalled();
	});

	it("resolves the fallback target path when the helper closes cleanly without output path", async () => {
		const proc = new FakeCaptureProcess();
		setWindowsCaptureOutputBuffer("Recording stopped without output path");
		setWindowsCaptureTargetPath("C:\\MoRec\\fallback.mp4");

		const stopped = waitForWindowsCaptureStop(
			proc as unknown as Parameters<typeof waitForWindowsCaptureStop>[0],
			1000,
		);
		proc.emit("close", 0);

		await expect(stopped).resolves.toBe("C:\\MoRec\\fallback.mp4");
		expect(proc.kill).not.toHaveBeenCalled();
	});

	it("rejects with helper output when the helper exits with a non-zero code", async () => {
		const proc = new FakeCaptureProcess();
		setWindowsCaptureOutputBuffer("Encoder error: insufficient memory");

		const stopped = waitForWindowsCaptureStop(
			proc as unknown as Parameters<typeof waitForWindowsCaptureStop>[0],
			1000,
		);
		proc.emit("close", 1);

		await expect(stopped).rejects.toThrow("Encoder error: insufficient memory");
		expect(proc.kill).not.toHaveBeenCalled();
	});

	it("rejects when the helper emits an error", async () => {
		const proc = new FakeCaptureProcess();
		const error = new Error("spawn failed");

		const stopped = waitForWindowsCaptureStop(
			proc as unknown as Parameters<typeof waitForWindowsCaptureStop>[0],
			1000,
		);
		proc.emit("error", error);

		await expect(stopped).rejects.toBe(error);
		expect(proc.kill).not.toHaveBeenCalled();
	});

	it("kills the helper and rejects when stop never completes", async () => {
		const proc = new FakeCaptureProcess();

		await expect(
			waitForWindowsCaptureStop(
				proc as unknown as Parameters<typeof waitForWindowsCaptureStop>[0],
				5,
			),
		).rejects.toThrow("Timed out waiting for native Windows capture to stop");
		expect(proc.kill).toHaveBeenCalledTimes(1);
	});
});

describe("attachWindowsCaptureLifecycle crash salvage", () => {
	let tempRoot: string;
	let recordingsRoot: string;

	beforeEach(() => {
		setWindowsCaptureOutputBuffer("");
		setWindowsCaptureStopRequested(false);
		setWindowsNativeCaptureActive(true);
	});

	afterEach(async () => {
		setWindowsNativeCaptureActive(false);
		setWindowsCaptureStopRequested(false);
		setWindowsCaptureTempPath(null);
		setWindowsCaptureTargetPath(null);
		setWindowsSystemAudioPath(null);
		setWindowsMicAudioPath(null);
		await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => undefined);
		await fs.rm(recordingsRoot, { recursive: true, force: true }).catch(() => undefined);
	});

	async function stageCrashedSession() {
		tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "morec-crash-temp-"));
		recordingsRoot = await fs.mkdtemp(path.join(os.tmpdir(), "morec-crash-final-"));
		const tempVideoPath = path.join(tempRoot, "morec-native-123.mp4");
		const tempSystemPath = path.join(tempRoot, "morec-native-123.system.wav");
		const tempMicPath = path.join(tempRoot, "morec-native-123.mic.wav");
		const tempMicJsonPath = `${tempMicPath}.json`;
		await fs.writeFile(tempVideoPath, "video-bytes");
		await fs.writeFile(tempSystemPath, "system-bytes");
		await fs.writeFile(tempMicPath, "mic-bytes");
		await fs.writeFile(tempMicJsonPath, '{"startDelayMs":42}');

		const finalVideoPath = path.join(recordingsRoot, "recording-123.mp4");
		const finalSystemPath = path.join(recordingsRoot, "recording-123.system.wav");
		const finalMicPath = path.join(recordingsRoot, "recording-123.mic.wav");
		setWindowsCaptureTempPath(tempVideoPath);
		setWindowsCaptureTargetPath(finalVideoPath);
		setWindowsSystemAudioPath(finalSystemPath);
		setWindowsMicAudioPath(finalMicPath);
		return { tempVideoPath, tempSystemPath, tempMicPath, tempMicJsonPath, finalVideoPath };
	}

	it("moves temp companion wavs (and timing json) next to the salvaged video", async () => {
		const staged = await stageCrashedSession();
		const proc = new FakeCaptureProcess();
		attachWindowsCaptureLifecycle(proc as unknown as Parameters<
			typeof attachWindowsCaptureLifecycle
		>[0]);

		proc.emit("close", 1);
		await new Promise((resolve) => setTimeout(resolve, 50));

		// Video salvaged to the final path; companions too; json follows the mic wav.
		await expect(fs.readFile(staged.finalVideoPath, "utf8")).resolves.toBe("video-bytes");
		await expect(
			fs.readFile(path.join(recordingsRoot, "recording-123.system.wav"), "utf8"),
		).resolves.toBe("system-bytes");
		await expect(
			fs.readFile(path.join(recordingsRoot, "recording-123.mic.wav"), "utf8"),
		).resolves.toBe("mic-bytes");
		await expect(
			fs.readFile(path.join(recordingsRoot, "recording-123.mic.wav.json"), "utf8"),
		).resolves.toBe('{"startDelayMs":42}');
		// Nothing left behind in %TEMP%.
		await expect(fs.access(staged.tempVideoPath)).rejects.toThrow();
		await expect(fs.access(staged.tempSystemPath)).rejects.toThrow();
		await expect(fs.access(staged.tempMicPath)).rejects.toThrow();
		// Stale companion state cleared so a later stop/recover cannot see them.
		expect(windowsSystemAudioPath).toBeNull();
		expect(windowsMicAudioPath).toBeNull();
	});
});
