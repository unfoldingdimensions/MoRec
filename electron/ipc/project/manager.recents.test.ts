import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IpcRegistry } from "../../test/ipcRegistry";

/**
 * Tests for the recent-projects store and the project library listing,
 * especially the contract that listing never prunes recents that are
 * temporarily unreadable (e.g. on an unmounted drive).
 */
describe("project manager recents + library listing", () => {
	const registry = new IpcRegistry();
	let tempRoot: string;
	let files: { userData: string; recordings: string; recents: string };
	let stateStore: {
		currentProjectPath: string | null;
		recordingsDirLoaded: boolean;
	};

	// saveRecentProjectPaths normalizes through normalizePath (win32 resolves
	// to absolute backslash paths); expectations go through the same helper.
	async function normalized(value: string) {
		const { normalizePath } = await import("../utils");
		return normalizePath(value);
	}

	async function writeRecents(paths: string[]) {
		await fs.writeFile(files.recents, JSON.stringify({ paths }, null, 2), "utf-8");
	}

	async function readRecents(): Promise<string[]> {
		const content = await fs.readFile(files.recents, "utf-8");
		return JSON.parse(content).paths;
	}

	beforeEach(async () => {
		vi.resetModules();
		registry.reset();
		registry.installElectronMock();

		tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "morec-recents-test-"));
		files = {
			userData: path.join(tempRoot, "userData"),
			recordings: path.join(tempRoot, "recordings"),
			recents: path.join(tempRoot, "recent-projects.json"),
		};
		await fs.mkdir(files.userData, { recursive: true });
		await fs.mkdir(files.recordings, { recursive: true });
		stateStore = { currentProjectPath: null, recordingsDirLoaded: false };

		vi.doMock("../../appPaths", () => ({
			USER_DATA_PATH: files.userData,
			RECORDINGS_DIR: files.recordings,
		}));
		vi.doMock("../constants", () => ({
			USER_DATA_PATH: files.userData,
			RECORDINGS_DIR: files.recordings,
			PROJECTS_DIRECTORY_NAME: "Projects",
			RECENT_PROJECTS_FILE: files.recents,
			RECORDINGS_SETTINGS_FILE: path.join(tempRoot, "recordings-settings.json"),
			MAX_RECENT_PROJECTS: 3,
			PROJECT_FILE_EXTENSION: "morec",
			LEGACY_PROJECT_FILE_EXTENSIONS: ["recordly"],
			PROJECT_THUMBNAIL_SUFFIX: ".thumb.png",
		}));
		vi.doMock("../state", () => ({
			approvedLocalReadPaths: new Set<string>(),
			get currentProjectPath() {
				return stateStore.currentProjectPath;
			},
			get customRecordingsDir() {
				return null;
			},
			get recordingsDirLoaded() {
				return stateStore.recordingsDirLoaded;
			},
			setCurrentProjectPath: (v: string | null) => {
				stateStore.currentProjectPath = v;
			},
			setCurrentRecordingSession: vi.fn(),
			setCurrentVideoPath: vi.fn(),
			setCustomRecordingsDir: vi.fn(),
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
		await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => undefined);
	});

	it("loadRecentProjectPaths returns an empty list when no store exists", async () => {
		const { loadRecentProjectPaths } = await import("./manager");
		expect(await loadRecentProjectPaths()).toEqual([]);
	});

	it("rememberRecentProject prepends, dedupes, and skips non-project files", async () => {
		const { rememberRecentProject, loadRecentProjectPaths } = await import("./manager");

		await rememberRecentProject("/disks/a.morec");
		await rememberRecentProject("/disks/b.txt");
		await rememberRecentProject("/disks/a.morec");

		expect(await loadRecentProjectPaths()).toEqual([await normalized("/disks/a.morec")]);
	});

	it("caps the recents list at MAX_RECENT_PROJECTS", async () => {
		const { rememberRecentProject, loadRecentProjectPaths } = await import("./manager");

		await rememberRecentProject("/disks/1.morec");
		await rememberRecentProject("/disks/2.morec");
		await rememberRecentProject("/disks/3.morec");
		await rememberRecentProject("/disks/4.morec");

		expect(await loadRecentProjectPaths()).toEqual([
			await normalized("/disks/4.morec"),
			await normalized("/disks/3.morec"),
			await normalized("/disks/2.morec"),
		]);
	});

	it("listing includes scanned Projects-directory files and recents", async () => {
		const { listProjectLibraryEntries } = await import("./manager");

		await fs.mkdir(path.join(files.recordings, "Projects"), { recursive: true });
		const inProjects = path.join(files.recordings, "Projects", "alpha.morec");
		await fs.writeFile(inProjects, "{}", "utf-8");
		const external = path.join(tempRoot, "beta.morec");
		await fs.writeFile(external, "{}", "utf-8");
		await writeRecents([external]);

		const { entries } = (await listProjectLibraryEntries()) as {
			entries: Array<{ path: string; isInProjectsDirectory: boolean }>;
		};

		expect(entries.map((entry) => entry.path).sort()).toEqual(
			[inProjects, external].sort(),
		);
		expect(entries.find((entry) => entry.path === inProjects)?.isInProjectsDirectory).toBe(
			true,
		);
		expect(entries.find((entry) => entry.path === external)?.isInProjectsDirectory).toBe(
			false,
		);
	});

	it("listing never prunes recents that are temporarily unreadable", async () => {
		const { listProjectLibraryEntries } = await import("./manager");

		await fs.mkdir(path.join(files.recordings, "Projects"), { recursive: true });
		// A recent on an "unmounted drive" (does not exist right now) plus one
		// that resolves; listing must keep both.
		const missing = path.join(tempRoot, "unmounted", "lost.morec");
		const existing = path.join(tempRoot, "kept.morec");
		await fs.writeFile(existing, "{}", "utf-8");
		await writeRecents([missing, existing]);

		const { entries } = (await listProjectLibraryEntries()) as {
			entries: Array<{ path: string }>;
		};

		expect(entries.map((entry) => entry.path)).toEqual([existing]);
		expect(await readRecents()).toEqual([existing, missing]);
	});
});
