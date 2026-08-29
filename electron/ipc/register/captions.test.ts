import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMockWebContents, IpcRegistry } from "../../test/ipcRegistry";

/**
 * Handler-level tests for `register/captions.ts`: file pickers (media,
 * audio, project routing), Whisper model status/download/delete, and
 * auto-caption generation message shaping. The real
 * `sendWhisperModelDownloadProgress` is kept so the destroyed-webContents
 * guard is exercised end to end.
 */
describe("register/captions handlers", () => {
	const registry = new IpcRegistry();
	const mocks = {
		approveUserPath: vi.fn(),
		setCurrentProjectPath: vi.fn(),
		getWhisperSmallModelStatus: vi.fn(),
		downloadWhisperSmallModel: vi.fn(),
		deleteWhisperSmallModel: vi.fn(),
		generateAutoCaptionsFromVideo: vi.fn(),
		loadProjectFromPath: vi.fn(),
	};

	beforeEach(async () => {
		vi.resetModules();
		registry.reset();
		registry.installElectronMock();

		for (const fn of Object.values(mocks)) {
			fn.mockReset();
		}

		vi.doMock("../captions/generate", () => ({
			generateAutoCaptionsFromVideo: mocks.generateAutoCaptionsFromVideo,
		}));
		vi.doMock("../captions/whisper", async (importOriginal) => {
			const actual = await importOriginal<typeof import("../captions/whisper")>();
			return {
				...actual,
				getWhisperSmallModelStatus: mocks.getWhisperSmallModelStatus,
				downloadWhisperSmallModel: mocks.downloadWhisperSmallModel,
				deleteWhisperSmallModel: mocks.deleteWhisperSmallModel,
			};
		});
		vi.doMock("../project/manager", () => ({
			hasProjectFileExtension: (candidate: string) => candidate.endsWith(".morec"),
			loadProjectFromPath: mocks.loadProjectFromPath,
		}));
		vi.doMock("../state", () => ({
			setCurrentProjectPath: mocks.setCurrentProjectPath,
		}));
		vi.doMock("../utils", () => ({
			approveUserPath: mocks.approveUserPath,
			getRecordingsDir: async () => "/userdata/recordings",
		}));
		vi.doMock("../constants", () => ({
			PROJECT_FILE_EXTENSION: "morec",
			LEGACY_PROJECT_FILE_EXTENSIONS: ["recordly"],
		}));

		const { registerCaptionHandlers } = await import("./captions");
		registerCaptionHandlers();
	});

	afterEach(() => {
		vi.resetModules();
		vi.doUnmock("electron");
		vi.doUnmock("../captions/generate");
		vi.doUnmock("../captions/whisper");
		vi.doUnmock("../project/manager");
		vi.doUnmock("../state");
		vi.doUnmock("../utils");
		vi.doUnmock("../constants");
	});

	async function pickDialogResult(result: unknown) {
		const electron = await import("electron");
		(electron.dialog.showOpenDialog as ReturnType<typeof vi.fn>).mockResolvedValue(result);
	}

	it("open-video-file-picker reports cancellation", async () => {
		await pickDialogResult({ canceled: true, filePaths: [] });

		expect(await registry.invoke("open-video-file-picker")).toEqual({
			success: false,
			canceled: true,
		});
		expect(mocks.approveUserPath).not.toHaveBeenCalled();
	});

	it("open-video-file-picker approves media selections and reports the extension", async () => {
		await pickDialogResult({ canceled: false, filePaths: ["/userdata/recordings/take.mp4"] });

		expect(await registry.invoke("open-video-file-picker")).toEqual({
			success: true,
			kind: "media",
			path: "/userdata/recordings/take.mp4",
			extension: "mp4",
		});
		expect(mocks.approveUserPath).toHaveBeenCalledWith("/userdata/recordings/take.mp4");
		expect(mocks.setCurrentProjectPath).toHaveBeenCalledWith(null);
	});

	it("open-video-file-picker routes project files through the project loader", async () => {
		mocks.loadProjectFromPath.mockResolvedValue({ success: true, name: "My Project" });
		await pickDialogResult({ canceled: false, filePaths: ["/userdata/projects/p.morec"] });

		expect(await registry.invoke("open-video-file-picker", { includeProjects: true })).toEqual({
			success: true,
			name: "My Project",
			kind: "project",
		});
		expect(mocks.loadProjectFromPath).toHaveBeenCalledWith("/userdata/projects/p.morec");
		expect(mocks.approveUserPath).not.toHaveBeenCalled();
	});

	it("open-audio-file-picker approves the selection", async () => {
		await pickDialogResult({ canceled: false, filePaths: ["/music/track.wav"] });

		expect(await registry.invoke("open-audio-file-picker")).toEqual({
			success: true,
			path: "/music/track.wav",
		});
		expect(mocks.approveUserPath).toHaveBeenCalledWith("/music/track.wav");
	});

	it("whisper executable and model pickers approve their selections", async () => {
		await pickDialogResult({ canceled: false, filePaths: ["/tools/whisper.exe"] });
		expect(await registry.invoke("open-whisper-executable-picker")).toEqual({
			success: true,
			path: "/tools/whisper.exe",
		});

		await pickDialogResult({ canceled: true, filePaths: [] });
		expect(await registry.invoke("open-whisper-model-picker")).toEqual({
			success: false,
			canceled: true,
		});
	});

	it("get-whisper-small-model-status passes the module result through", async () => {
		mocks.getWhisperSmallModelStatus.mockResolvedValue({
			success: true,
			exists: true,
			path: "/models/whisper.bin",
		});

		expect(await registry.invoke("get-whisper-small-model-status")).toEqual({
			success: true,
			exists: true,
			path: "/models/whisper.bin",
		});
	});

	it("download-whisper-small-model short-circuits when the model already exists", async () => {
		const sender = createMockWebContents();
		mocks.getWhisperSmallModelStatus.mockResolvedValue({
			success: true,
			exists: true,
			path: "/models/whisper.bin",
		});

		const result = await registry.getHandler("download-whisper-small-model")!({ sender });

		expect(result).toEqual({
			success: true,
			path: "/models/whisper.bin",
			alreadyDownloaded: true,
		});
		expect(mocks.downloadWhisperSmallModel).not.toHaveBeenCalled();
		expect(sender.send).toHaveBeenCalledWith("whisper-small-model-download-progress", {
			status: "downloaded",
			progress: 100,
			path: "/models/whisper.bin",
		});
	});

	it("download-whisper-small-model skips progress sends to destroyed windows", async () => {
		const sender = createMockWebContents();
		sender.isDestroyed.mockReturnValue(true);
		mocks.getWhisperSmallModelStatus.mockResolvedValue({ success: true, exists: false, path: null });
		mocks.downloadWhisperSmallModel.mockResolvedValue("/models/whisper.bin");

		// A window closed mid-download must not crash the handler.
		const result = await registry.getHandler("download-whisper-small-model")!({ sender });

		expect(result).toEqual({ success: true, path: "/models/whisper.bin" });
		expect(sender.send).not.toHaveBeenCalled();
	});

	it("delete-whisper-small-model reports idle on success", async () => {
		const sender = createMockWebContents();
		mocks.deleteWhisperSmallModel.mockResolvedValue(undefined);

		expect(await registry.getHandler("delete-whisper-small-model")!({ sender })).toEqual({
			success: true,
		});
		expect(sender.send).toHaveBeenCalledWith("whisper-small-model-download-progress", {
			status: "idle",
			progress: 0,
			path: null,
		});
	});

	it("delete-whisper-small-model reports success when the file is gone despite the error", async () => {
		const sender = createMockWebContents();
		mocks.deleteWhisperSmallModel.mockRejectedValue(new Error("boom"));
		mocks.getWhisperSmallModelStatus.mockResolvedValue({ success: true, exists: false, path: null });

		expect(await registry.getHandler("delete-whisper-small-model")!({ sender })).toEqual({
			success: true,
		});
	});

	it("delete-whisper-small-model reports an error when the model remains", async () => {
		const sender = createMockWebContents();
		mocks.deleteWhisperSmallModel.mockRejectedValue(new Error("EACCES"));
		mocks.getWhisperSmallModelStatus.mockResolvedValue({
			success: true,
			exists: true,
			path: "/models/whisper.bin",
		});

		const result = await registry.getHandler("delete-whisper-small-model")!({ sender });

		expect(result).toEqual({ success: false, error: "Error: EACCES" });
		expect(sender.send).toHaveBeenCalledWith("whisper-small-model-download-progress", {
			status: "error",
			progress: 0,
			path: null,
			error: "Error: EACCES",
		});
	});

	it("generate-auto-captions shapes messages by audio source", async () => {
		mocks.generateAutoCaptionsFromVideo.mockResolvedValue({
			cues: [{ startMs: 0, endMs: 1000, text: "Hi" }],
			audioSourceLabel: "recording",
		});

		const fromRecording = (await registry.invoke("generate-auto-captions", {
			videoPath: "/v.mp4",
			whisperExecutablePath: "/w",
			whisperModelPath: "/m",
		})) as { message: string };
		expect(fromRecording.message).toBe("Generated 1 caption cues.");

		mocks.generateAutoCaptionsFromVideo.mockResolvedValue({
			cues: [],
			audioSourceLabel: "system audio",
		});
		const fromSystem = (await registry.invoke("generate-auto-captions", {
			videoPath: "/v.mp4",
			whisperExecutablePath: "/w",
			whisperModelPath: "/m",
		})) as { message: string };
		expect(fromSystem.message).toBe("Generated 0 caption cues from the system audio.");
	});

	it("generate-auto-captions reports failures without throwing", async () => {
		mocks.generateAutoCaptionsFromVideo.mockRejectedValue(new Error("whisper crashed"));

		const result = (await registry.invoke("generate-auto-captions", {
			videoPath: "/v.mp4",
			whisperExecutablePath: "/w",
			whisperModelPath: "/m",
		})) as { success: boolean; message: string };

		expect(result.success).toBe(false);
		expect(result.message).toBe("Failed to generate auto captions");
	});
});
