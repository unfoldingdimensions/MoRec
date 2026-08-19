import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tempDirs: string[] = [];

async function makeTempDir(prefix = "morec-project-test-") {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
	tempDirs.push(dir);
	return dir;
}

type IpcHandler = (_: unknown, ...args: unknown[]) => Promise<unknown>;

describe("delete-recording-file IPC handler", () => {
	let testTempRoot: string;
	let testUserDataDir: string;
	let testRecordingsDir: string;
	let testOutsideDir: string;
	const ipcHandlers = new Map<string, IpcHandler>();

	let mockCurrentVideoPath: string | null = null;
	let mockCurrentRecordingSession: unknown = null;

	beforeEach(async () => {
		testTempRoot = await makeTempDir("morec-ipc-root-");
		testUserDataDir = path.join(testTempRoot, "userData");
		testRecordingsDir = path.join(testUserDataDir, "recordings");
		testOutsideDir = path.join(testTempRoot, "outside");

		await fs.mkdir(testUserDataDir, { recursive: true });
		await fs.mkdir(testRecordingsDir, { recursive: true });
		await fs.mkdir(testOutsideDir, { recursive: true });

		ipcHandlers.clear();
		mockCurrentVideoPath = null;
		mockCurrentRecordingSession = null;

		vi.resetModules();

		vi.doMock("electron", () => ({
			app: {
				getAppPath: () => testTempRoot,
				getPath: (name: string) => {
					if (name === "userData") return testUserDataDir;
					if (name === "temp") return os.tmpdir();
					return testTempRoot;
				},
				isPackaged: false,
				isReady: () => true,
			},
			BrowserWindow: {
				getAllWindows: () => [],
				fromWebContents: () => null,
			},
			dialog: {
				showOpenDialog: vi.fn(),
				showSaveDialog: vi.fn(),
			},
			shell: {
				showItemInFolder: vi.fn(),
				openPath: vi.fn(),
			},
			ipcMain: {
				handle: (channel: string, handler: IpcHandler) => {
					ipcHandlers.set(channel, handler);
				},
				removeHandler: (channel: string) => {
					ipcHandlers.delete(channel);
				},
			},
		}));

		vi.doMock("../../appPaths", () => ({
			USER_DATA_PATH: testUserDataDir,
			RECORDINGS_DIR: testRecordingsDir,
		}));

		vi.doMock("../state", () => ({
			get currentVideoPath() {
				return mockCurrentVideoPath;
			},
			get currentRecordingSession() {
				return mockCurrentRecordingSession;
			},
			get currentProjectPath() {
				return null;
			},
			approvedLocalReadPaths: new Set<string>(),
			customRecordingsDir: null,
			recordingsDirLoaded: true,
			setCurrentVideoPath: (val: string | null) => {
				mockCurrentVideoPath = val;
			},
			setCurrentRecordingSession: (val: unknown) => {
				mockCurrentRecordingSession = val;
			},
			setCurrentProjectPath: vi.fn(),
			setCustomRecordingsDir: vi.fn(),
			setRecordingsDirLoaded: vi.fn(),
		}));

		const { registerProjectHandlers } = await import("./project");
		registerProjectHandlers();
	});

	afterEach(async () => {
		vi.resetModules();
		vi.doUnmock("electron");
		vi.doUnmock("../../appPaths");
		vi.doUnmock("../state");

		await Promise.allSettled(
			tempDirs.splice(0).map((dir) => fs.rm(dir, { force: true, recursive: true })),
		);
	});

	it("registers the delete-recording-file handler", () => {
		expect(ipcHandlers.has("delete-recording-file")).toBe(true);
	});

	it("deletes main recording and all companion sidecars (.mic.wav, .system.wav, .diagnostics.json, -webcam.*, etc.)", async () => {
		const deleteHandler = ipcHandlers.get("delete-recording-file")!;
		const baseName = "recording-2026-08-19-120000";
		const mainVideo = path.join(testRecordingsDir, `${baseName}.mp4`);
		await fs.writeFile(mainVideo, "video content");

		const companionFiles = [
			`${baseName}.mic.wav`,
			`${baseName}.mic.wav.json`,
			`${baseName}.system.wav`,
			`${baseName}.system.wav.json`,
			`${baseName}.mic.m4a`,
			`${baseName}.mic.m4a.json`,
			`${baseName}.system.m4a`,
			`${baseName}.system.m4a.json`,
			`${baseName}.mic.webm`,
			`${baseName}.mic.webm.json`,
			`${baseName}.system.webm`,
			`${baseName}.system.webm.json`,
			`${baseName}.mic.source.webm`,
			`${baseName}.mic.source.webm.tmp`,
			`${baseName}.diagnostics.json`,
			`${baseName}.recording-diagnostics.json`,
			`${baseName}.cursor.json`,
			`${baseName}.telemetry.json`,
			`${baseName}.morec-session.json`,
			`${baseName}.mp4.cursor.json`,
			`${baseName}.mp4.morec-session.json`,
			`${baseName}.mp4.mic.wav`,
			`${baseName}-webcam.webm`,
			`${baseName}-webcam.mp4`,
			`${baseName}-webcam-preview.png`,
			`${baseName}-webcam.diagnostics.json`,
			`${baseName}-webcam`,
		];

		for (const file of companionFiles) {
			await fs.writeFile(path.join(testRecordingsDir, file), "sidecar content");
		}

		// Create files that should NOT be deleted
		const preservedFiles = [
			"recording-2026-08-19-999999.mp4",
			"recording-2026-08-19-999999.mic.wav",
			"recording-2026-08-19-999999-webcam.webm",
			"unrelated-notes.txt",
			`${baseName}-webcam2.mp4`,
		];

		for (const file of preservedFiles) {
			await fs.writeFile(path.join(testRecordingsDir, file), "preserve me");
		}

		const result = await deleteHandler(null, mainVideo);
		expect(result).toEqual({ success: true });

		// Verify main video is deleted
		await expect(fs.access(mainVideo)).rejects.toThrow();

		// Verify all companion files are deleted
		for (const file of companionFiles) {
			await expect(fs.access(path.join(testRecordingsDir, file))).rejects.toThrow();
		}

		// Verify preserved files remain untouched
		for (const file of preservedFiles) {
			await expect(fs.readFile(path.join(testRecordingsDir, file), "utf8")).resolves.toBe(
				"preserve me",
			);
		}
	});

	it("clears currentVideoPath and currentRecordingSession if the deleted video was active", async () => {
		const deleteHandler = ipcHandlers.get("delete-recording-file")!;
		const mainVideo = path.join(testRecordingsDir, "recording-active.mp4");
		await fs.writeFile(mainVideo, "video");

		mockCurrentVideoPath = mainVideo;
		mockCurrentRecordingSession = { id: "test-session", videoPath: mainVideo };

		const result = await deleteHandler(null, mainVideo);
		expect(result).toEqual({ success: true });
		expect(mockCurrentVideoPath).toBeNull();
		expect(mockCurrentRecordingSession).toBeNull();
	});

	it("retains currentVideoPath if a different video is deleted", async () => {
		const deleteHandler = ipcHandlers.get("delete-recording-file")!;
		const mainVideo = path.join(testRecordingsDir, "recording-to-delete.mp4");
		const otherVideo = path.join(testRecordingsDir, "recording-keep-active.mp4");
		await fs.writeFile(mainVideo, "video 1");
		await fs.writeFile(otherVideo, "video 2");

		mockCurrentVideoPath = otherVideo;
		mockCurrentRecordingSession = { id: "active-session", videoPath: otherVideo };

		const result = await deleteHandler(null, mainVideo);
		expect(result).toEqual({ success: true });
		expect(mockCurrentVideoPath).toBe(otherVideo);
		expect(mockCurrentRecordingSession).toEqual({
			id: "active-session",
			videoPath: otherVideo,
		});
	});

	describe("security & path traversal defenses", () => {
		it("rejects path traversal attempting to escape the recordings directory", async () => {
			const deleteHandler = ipcHandlers.get("delete-recording-file")!;
			const outsideFile = path.join(testOutsideDir, "recording-secret.mp4");
			await fs.writeFile(outsideFile, "confidential");

			const relativeTraversal = path.join(
				testRecordingsDir,
				"..",
				"..",
				"outside",
				"recording-secret.mp4",
			);

			const result = (await deleteHandler(null, relativeTraversal)) as {
				success: boolean;
				error?: string;
			};
			expect(result.success).toBe(false);
			expect(result.error).toBe("Only auto-generated recordings can be deleted");

			// Ensure target file was NOT deleted
			await expect(fs.readFile(outsideFile, "utf8")).resolves.toBe("confidential");
		});

		it("rejects files outside the recordings directory even if they start with recording-", async () => {
			const deleteHandler = ipcHandlers.get("delete-recording-file")!;
			const outsideFile = path.join(testOutsideDir, "recording-system-file.mp4");
			await fs.writeFile(outsideFile, "system data");

			const result = (await deleteHandler(null, outsideFile)) as {
				success: boolean;
				error?: string;
			};
			expect(result.success).toBe(false);
			expect(result.error).toBe("Only auto-generated recordings can be deleted");

			// Ensure file was NOT deleted
			await expect(fs.readFile(outsideFile, "utf8")).resolves.toBe("system data");
		});

		it("rejects sibling directory paths matching prefix without directory separator", async () => {
			const deleteHandler = ipcHandlers.get("delete-recording-file")!;
			const siblingDir = `${testRecordingsDir}_sibling`;
			await fs.mkdir(siblingDir, { recursive: true });
			tempDirs.push(siblingDir);

			const siblingFile = path.join(siblingDir, "recording-sibling.mp4");
			await fs.writeFile(siblingFile, "sibling data");

			const result = (await deleteHandler(null, siblingFile)) as {
				success: boolean;
				error?: string;
			};
			expect(result.success).toBe(false);
			expect(result.error).toBe("Only auto-generated recordings can be deleted");

			// Ensure file was NOT deleted
			await expect(fs.readFile(siblingFile, "utf8")).resolves.toBe("sibling data");
		});

		it("rejects non-auto-recording project files inside recordings directory", async () => {
			const deleteHandler = ipcHandlers.get("delete-recording-file")!;
			const projectFile = path.join(testRecordingsDir, "my-saved-project.morec");
			await fs.writeFile(projectFile, "saved project");

			const result = (await deleteHandler(null, projectFile)) as {
				success: boolean;
				error?: string;
			};
			expect(result.success).toBe(false);
			expect(result.error).toBe("Only auto-generated recordings can be deleted");

			// Ensure file was NOT deleted
			await expect(fs.readFile(projectFile, "utf8")).resolves.toBe("saved project");
		});

		it("rejects empty, null, or undefined filePath", async () => {
			const deleteHandler = ipcHandlers.get("delete-recording-file")!;

			const resEmpty = (await deleteHandler(null, "")) as { success: boolean };
			expect(resEmpty.success).toBe(false);

			const resNull = (await deleteHandler(null, null as unknown as string)) as {
				success: boolean;
			};
			expect(resNull.success).toBe(false);

			const resUndef = (await deleteHandler(null, undefined as unknown as string)) as {
				success: boolean;
			};
			expect(resUndef.success).toBe(false);
		});

		it("rejects symlinks inside recordings directory pointing to outside files", async () => {
			const deleteHandler = ipcHandlers.get("delete-recording-file")!;
			const outsideTarget = path.join(testOutsideDir, "outside-secret.txt");
			const symlinkInside = path.join(testRecordingsDir, "recording-symlink.mp4");
			await fs.writeFile(outsideTarget, "top secret");

			try {
				await fs.symlink(outsideTarget, symlinkInside);
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code === "EPERM") {
					// Windows without Developer Mode permissions
					return;
				}
				throw error;
			}

			const result = (await deleteHandler(null, symlinkInside)) as {
				success: boolean;
				error?: string;
			};
			expect(result.success).toBe(false);
			expect(result.error).toBe("Only auto-generated recordings can be deleted");

			// Target outside file must NOT be deleted
			await expect(fs.readFile(outsideTarget, "utf8")).resolves.toBe("top secret");
		});

		it("succeeds idempotently when the file does not exist", async () => {
			const deleteHandler = ipcHandlers.get("delete-recording-file")!;
			const missingFile = path.join(testRecordingsDir, "recording-missing.mp4");

			const result = await deleteHandler(null, missingFile);
			expect(result).toEqual({ success: true });
		});

		it("does not delete or fail if a subdirectory shares the recording webcam prefix", async () => {
			const deleteHandler = ipcHandlers.get("delete-recording-file")!;
			const baseName = "recording-subfolder-test";
			const mainVideo = path.join(testRecordingsDir, `${baseName}.mp4`);
			const subfolder = path.join(testRecordingsDir, `${baseName}-webcam-folder`);
			await fs.writeFile(mainVideo, "video");
			await fs.mkdir(subfolder, { recursive: true });

			const result = await deleteHandler(null, mainVideo);
			expect(result).toEqual({ success: true });

			// Video should be deleted
			await expect(fs.access(mainVideo)).rejects.toThrow();
			// Subdirectory should still exist
			const stat = await fs.stat(subfolder);
			expect(stat.isDirectory()).toBe(true);
		});
	});
});
