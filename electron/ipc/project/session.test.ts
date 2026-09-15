import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Tests for the .morec-session.json lifecycle: atomic commit, webcam link
 * resolution, and the crash-recovery fallback when the manifest is torn.
 */
describe("recording session manifest persistence", () => {
	let tempRoot: string;
	let videoPath: string;
	let webcamPath: string;

	beforeEach(async () => {
		tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "morec-session-test-"));
		videoPath = path.join(tempRoot, "recording-100.mp4");
		webcamPath = path.join(tempRoot, "recording-100-webcam.webm");
		await fs.writeFile(videoPath, "video");
		await fs.writeFile(webcamPath, "webcam");

		vi.resetModules();
		vi.doMock("electron", () => ({
			app: {
				isPackaged: false,
				getAppPath: () => tempRoot,
				getPath: (name: string) =>
					name === "userData" ? path.join(tempRoot, "userData") : tempRoot,
				setPath: () => undefined,
			},
		}));
	});

	afterEach(async () => {
		vi.resetModules();
		vi.doUnmock("electron");
		await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => undefined);
	});

	async function importSession() {
		return import("./session");
	}

	function manifestPath() {
		return path.join(tempRoot, "recording-100.morec-session.json");
	}

	it("persists a webcam session and resolves it back with the sync offset", async () => {
		const { persistRecordingSessionManifest, resolveRecordingSessionManifest } =
			await importSession();

		await persistRecordingSessionManifest({
			videoPath,
			webcamPath,
			timeOffsetMs: 120,
			hideOverlayCursorByDefault: true,
		});

		await expect(fs.readFile(manifestPath(), "utf-8")).resolves.toContain('"webcamFileName"');

		const session = await resolveRecordingSessionManifest(videoPath);
		expect(session).toMatchObject({
			videoPath,
			webcamPath,
			timeOffsetMs: 120,
			hideOverlayCursorByDefault: true,
		});
	});

	it("resolves a v2 manifest without a cursor flag as false", async () => {
		const { resolveRecordingSessionManifest } = await importSession();

		await fs.writeFile(
			manifestPath(),
			JSON.stringify({
				version: 2,
				videoFileName: "recording-100.mp4",
				webcamFileName: "recording-100-webcam.webm",
				timeOffsetMs: 10,
			}),
			"utf-8",
		);

		const session = await resolveRecordingSessionManifest(videoPath);
		expect(session).toMatchObject({
			webcamPath,
			timeOffsetMs: 10,
			hideOverlayCursorByDefault: false,
		});
	});

	it("removes the manifest when the session no longer has a webcam", async () => {
		const { persistRecordingSessionManifest } = await importSession();

		await persistRecordingSessionManifest({ videoPath, webcamPath, timeOffsetMs: 0 });
		await persistRecordingSessionManifest({ videoPath, webcamPath: null, timeOffsetMs: 0 });

		await expect(fs.access(manifestPath())).rejects.toMatchObject({ code: "ENOENT" });
	});

	it("ignores webcam links that are not plain filenames in the video directory", async () => {
		const { resolveRecordingSessionManifest } = await importSession();

		// A poisoned manifest (synced file, hand-edited sidecar) must not be
		// able to point the webcam link outside the video's directory: the
		// link is dropped while the parsed offset is kept.
		const taintedWebcamFileNames = [
			"..\\..\\sibling-secret.mp4",
			"../../sibling-secret.mp4",
			"sub/sibling-secret.mp4",
			"sub\\sibling-secret.mp4",
			".",
			"..",
		];

		for (const webcamFileName of taintedWebcamFileNames) {
			await fs.writeFile(
				manifestPath(),
				JSON.stringify({
					version: 2,
					videoFileName: "recording-100.mp4",
					webcamFileName,
					timeOffsetMs: 55,
				}),
				"utf-8",
			);

			const session = await resolveRecordingSessionManifest(videoPath);
			expect(session?.webcamPath, `webcamFileName: ${webcamFileName}`).toBeNull();
			expect(session?.timeOffsetMs).toBe(55);
		}
	});

	it("falls back to the -webcam naming convention with a zero offset when the manifest is torn", async () => {
		const { resolveRecordingSession } = await importSession();

		// Simulate a crash mid-manifest-write: partial JSON on disk.
		await fs.writeFile(
			manifestPath(),
			'{"version":2,"videoFileName":"recording-100.mp4","webcamFileName":"recording-100-web',
			"utf-8",
		);

		const session = await resolveRecordingSession(videoPath);
		expect(session).not.toBeNull();
		expect(session?.webcamPath).toBe(webcamPath);
		expect(session?.timeOffsetMs ?? 0).toBe(0);
	});

	it("commits the manifest atomically, preserving the previous generation", async () => {
		const { persistRecordingSessionManifest } = await importSession();

		await persistRecordingSessionManifest({ videoPath, webcamPath, timeOffsetMs: 40 });
		await persistRecordingSessionManifest({ videoPath, webcamPath, timeOffsetMs: 90 });

		const backupContent = await fs.readFile(`${manifestPath()}.bak`, "utf-8");
		expect(backupContent).toContain('"timeOffsetMs": 40');

		const entries = await fs.readdir(tempRoot);
		expect(entries.filter((entry) => entry.endsWith(".tmp"))).toEqual([]);
	});
});
