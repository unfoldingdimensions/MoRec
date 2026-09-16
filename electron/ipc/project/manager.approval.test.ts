import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Regression tests for the renderer-facing local-read approval gates
 * (finding F1): renderer-controlled IPC channels must not be able to add
 * arbitrary paths to `approvedLocalReadPaths`, and a single lexical
 * (picker-style) approval must admit the path's realpath variant as a pair
 * so picked media stays playable after the session set is replaced.
 */
describe("local read approval gates", () => {
	let tempRoot: string;
	let appDataPath: string;
	let userDataPath: string;
	let tempPath: string;
	let appPath: string;
	let recordingsDir: string;
	let outsideDir: string;
	const stateApproved = new Set<string>();
	const ipcHandlers = new Map<string, (_: unknown, ...args: unknown[]) => Promise<unknown>>();
	const stateStore: {
		currentProjectPath: string | null;
		customRecordingsDir: string | null;
		recordingsDirLoaded: boolean;
	} = { currentProjectPath: null, customRecordingsDir: null, recordingsDirLoaded: false };

	async function createDirectoryLink(linkPath: string, targetPath: string) {
		if (process.platform === "win32") {
			// Junctions need no elevated permissions on Windows, unlike symlinks,
			// and realpath resolves them just the same.
			await fs.symlink(targetPath, linkPath, "junction");
		} else {
			await fs.symlink(targetPath, linkPath, "dir");
		}
	}

	beforeEach(async () => {
		tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "morec-approval-gates-"));
		appDataPath = path.join(tempRoot, "AppData");
		userDataPath = path.join(tempRoot, "UserData");
		tempPath = path.join(tempRoot, "Temp");
		appPath = path.join(tempRoot, "App");
		recordingsDir = path.join(userDataPath, "recordings");
		outsideDir = path.join(tempRoot, "Outside");

		await Promise.all(
			[appDataPath, userDataPath, tempPath, appPath, recordingsDir, outsideDir].map(
				(dirPath) => fs.mkdir(dirPath, { recursive: true }),
			),
		);

		stateApproved.clear();
		ipcHandlers.clear();
		stateStore.currentProjectPath = null;
		stateStore.customRecordingsDir = null;
		stateStore.recordingsDirLoaded = false;

		vi.resetModules();
		vi.doMock("electron", () => ({
			app: {
				isPackaged: false,
				getAppPath: () => appPath,
				getPath: (name: string) => {
					if (name === "appData") return appDataPath;
					if (name === "userData") return userDataPath;
					if (name === "temp") return tempPath;
					return tempRoot;
				},
				setPath: () => undefined,
				on: () => undefined,
			},
			ipcMain: {
				handle: (
					channel: string,
					handler: (_: unknown, ...args: unknown[]) => Promise<unknown>,
				) => {
					ipcHandlers.set(channel, handler);
				},
				removeHandler: (channel: string) => {
					ipcHandlers.delete(channel);
				},
			},
		}));
		vi.doMock("../../appPaths", () => ({
			USER_DATA_PATH: userDataPath,
			RECORDINGS_DIR: recordingsDir,
		}));
		vi.doMock("../constants", () => ({
			LEGACY_PROJECT_FILE_EXTENSIONS: ["recordly"],
			MAX_RECENT_PROJECTS: 16,
			PROJECT_FILE_EXTENSION: "morec",
			PROJECT_THUMBNAIL_SUFFIX: ".preview.png",
			PROJECTS_DIRECTORY_NAME: "Projects",
			RECENT_PROJECTS_FILE: path.join(userDataPath, "recent-projects.json"),
			RECORDINGS_SETTINGS_FILE: path.join(userDataPath, "recordings-settings.json"),
			RECORDING_SESSION_MANIFEST_SUFFIX: ".morec-session.json",
			AUTO_RECORDING_PREFIX: "recording-",
		}));
		vi.doMock("../state", () => ({
			approvedLocalReadPaths: stateApproved,
			get currentProjectPath() {
				return stateStore.currentProjectPath;
			},
			get customRecordingsDir() {
				return stateStore.customRecordingsDir;
			},
			get recordingsDirLoaded() {
				return stateStore.recordingsDirLoaded;
			},
			setCurrentProjectPath: (v: string | null) => {
				stateStore.currentProjectPath = v;
			},
			setCurrentRecordingSession: vi.fn(),
			setCurrentVideoPath: vi.fn(),
			setCustomRecordingsDir: (v: string | null) => {
				stateStore.customRecordingsDir = v;
			},
			setRecordingsDirLoaded: (v: boolean) => {
				stateStore.recordingsDirLoaded = v;
			},
		}));
	});

	afterEach(async () => {
		vi.resetModules();
		vi.doUnmock("electron");
		vi.doUnmock("../../appPaths");
		vi.doUnmock("../constants");
		vi.doUnmock("../state");
		if (tempRoot) {
			await fs.rm(tempRoot, { recursive: true, force: true });
		}
	});

	it("does not let renderer-supplied paths approve themselves via rememberApprovedLocalReadPath", async () => {
		const attackerFile = path.join(outsideDir, "secret.mp4");
		await fs.writeFile(attackerFile, "secret-bytes");

		const { isAllowedLocalMediaPath, rememberApprovedLocalReadPath } = await import(
			"./manager"
		);
		const { isAllowedMediaPath } = await import("../../mediaServer");

		await rememberApprovedLocalReadPath(attackerFile);

		expect(stateApproved.size).toBe(0);
		await expect(isAllowedLocalMediaPath(attackerFile)).resolves.toBe(false);
		expect(isAllowedMediaPath(await fs.realpath(attackerFile))).toBe(false);
	});

	it("does not let renderer-supplied paths approve themselves via replaceApprovedSessionLocalReadPaths", async () => {
		const attackerFile = path.join(outsideDir, "secret.mp4");
		await fs.writeFile(attackerFile, "secret-bytes");

		const { isAllowedLocalMediaPath, replaceApprovedSessionLocalReadPaths } = await import(
			"./manager"
		);
		const { isAllowedMediaPath } = await import("../../mediaServer");

		await replaceApprovedSessionLocalReadPaths([attackerFile, null]);

		expect(stateApproved.size).toBe(0);
		await expect(isAllowedLocalMediaPath(attackerFile)).resolves.toBe(false);
		expect(isAllowedMediaPath(await fs.realpath(attackerFile))).toBe(false);
	});

	it("admits the realpath variant as a pair when only the lexical spelling is approved", async () => {
		const realDir = path.join(tempRoot, "recordings-real");
		const linkDir = path.join(tempRoot, "recordings-link");
		await fs.mkdir(realDir, { recursive: true });
		await createDirectoryLink(linkDir, realDir);

		const lexicalMediaPath = path.join(linkDir, "picked.mp4");
		await fs.writeFile(lexicalMediaPath, "video-bytes");
		const realSpelling = await fs.realpath(lexicalMediaPath);
		expect(realSpelling).not.toBe(path.resolve(lexicalMediaPath));

		const { isAllowedLocalMediaPath, rememberApprovedLocalReadPath } = await import(
			"./manager"
		);
		const { isAllowedMediaPath } = await import("../../mediaServer");
		const { approveUserPath } = await import("../utils");

		// Production pickers approve the dialog result exactly once.
		approveUserPath(lexicalMediaPath);
		await rememberApprovedLocalReadPath(lexicalMediaPath);

		await expect(isAllowedLocalMediaPath(lexicalMediaPath)).resolves.toBe(true);
		// The realpath spelling names the same real file and is admitted with it.
		await expect(isAllowedLocalMediaPath(realSpelling)).resolves.toBe(true);
		expect(isAllowedMediaPath(realSpelling)).toBe(true);
	});

	it("keeps a lexically-approved picked path playable when the session set is replaced", async () => {
		const realDir = path.join(tempRoot, "recordings-real");
		const linkDir = path.join(tempRoot, "recordings-link");
		await fs.mkdir(realDir, { recursive: true });
		await createDirectoryLink(linkDir, realDir);

		const lexicalMediaPath = path.join(linkDir, "picked.mp4");
		await fs.writeFile(lexicalMediaPath, "video-bytes");
		const realSpelling = await fs.realpath(lexicalMediaPath);

		const { replaceApprovedSessionLocalReadPaths } = await import("./manager");
		const { isAllowedMediaPath } = await import("../../mediaServer");
		const { approveUserPath } = await import("../utils");

		approveUserPath(lexicalMediaPath);
		// set-current-video-path replaces the whole session set; the single
		// lexical picker approval must survive as a lexical+realpath pair.
		await replaceApprovedSessionLocalReadPaths([lexicalMediaPath, null]);

		expect(stateApproved.has(path.resolve(lexicalMediaPath))).toBe(true);
		expect(stateApproved.has(realSpelling)).toBe(true);
		expect(isAllowedMediaPath(realSpelling)).toBe(true);
	});

	it("honors the effective (custom) recordings directory as an allowed prefix", async () => {
		const customRecordingsDir = path.join(tempRoot, "custom-takes");
		await fs.mkdir(customRecordingsDir, { recursive: true });
		const { setCustomRecordingsDir } = await import("../state");
		setCustomRecordingsDir(customRecordingsDir);

		const { isAllowedLocalReadPath } = await import("./manager");

		await expect(
			isAllowedLocalReadPath(path.join(customRecordingsDir, "recording-1.mp4")),
		).toBe(true);
		// The default recordings directory stays allowed via the userData prefix.
		await expect(isAllowedLocalReadPath(path.join(recordingsDir, "recording-2.mp4"))).toBe(
			true,
		);
		await expect(isAllowedLocalReadPath(path.join(outsideDir, "secret.mp4"))).toBe(false);
	});

	it("blocks recordingsDir injected through set-recording-preferences end to end", async () => {
		vi.doMock("../../windows", () => ({
			createCountdownWindow: vi.fn(),
			closeCountdownWindow: vi.fn(),
			getCountdownWindow: vi.fn(),
		}));
		vi.doMock("../../cursorHider", () => ({
			hideCursor: vi.fn(() => true),
			showCursor: vi.fn(),
		}));

		const { registerSettingsHandlers } = await import("../register/settings");
		registerSettingsHandlers();

		const attackerTree = path.join(tempRoot, "victim-home");
		const prefsHandler = ipcHandlers.get("set-recording-preferences")!;
		await prefsHandler(null, { microphoneEnabled: true, recordingsDir: attackerTree });

		const settingsFile = path.join(userDataPath, "recordings-settings.json");
		const stored = JSON.parse(await fs.readFile(settingsFile, "utf-8"));
		expect(stored.recordingsDir).toBeUndefined();

		// getRecordingsDir() loads the (unpoisoned) settings file, so the
		// attacker tree never becomes an allowed read prefix.
		const { getRecordingsDir } = await import("../utils");
		await expect(getRecordingsDir()).resolves.toBe(recordingsDir);

		const { isAllowedLocalReadPath } = await import("./manager");
		await expect(isAllowedLocalReadPath(path.join(attackerTree, "secret.mp4"))).toBe(false);
		await expect(isAllowedLocalReadPath(path.join(recordingsDir, "recording-3.mp4"))).toBe(
			true,
		);
	});

	it("only admits morec-prefixed first segments under the temp root", async () => {
		const { isAllowedLocalReadPath } = await import("./manager");

		// A file directly under the temp root is not an app artifact.
		await expect(isAllowedLocalReadPath(path.join(tempPath, "notes.txt"))).toBe(false);
		// The app's own temp artifacts keep working.
		await expect(
			isAllowedLocalReadPath(path.join(tempPath, "morec-export-x", "file.mp4")),
		).toBe(true);
		await expect(isAllowedLocalReadPath(path.join(tempPath, ".morec-session", "file"))).toBe(
			true,
		);
		// Other applications' temp trees stay rejected.
		await expect(isAllowedLocalReadPath(path.join(tempPath, "OtherApp", "secret"))).toBe(false);
		// Non-temp prefixes are unaffected.
		await expect(isAllowedLocalReadPath(path.join(recordingsDir, "recording-4.mp4"))).toBe(
			true,
		);
		await expect(isAllowedLocalReadPath(path.join(userDataPath, "project.morec"))).toBe(true);
	});
});
