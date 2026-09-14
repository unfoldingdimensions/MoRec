import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { approveUserWritePath } from "../approvedPaths";
import { IpcRegistry } from "../../test/ipcRegistry";

/**
 * Full export-stream integration: open an in-memory export stream, stream
 * chunks through the renderer-facing handlers, close it, and finalize into
 * an approved destination — asserting the temp session directory cleanup
 * and the approved-path gate.
 */
describe("export stream → finalize flow", () => {
	const registry = new IpcRegistry();
	let tempRoot: string;
	let destination: string;

	beforeEach(async () => {
		vi.resetModules();
		registry.reset();
		registry.installElectronMock();

		tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "morec-export-stream-test-"));
		destination = path.join(tempRoot, "out", "video.mp4");

		vi.doMock("../../appPaths", () => ({
			USER_DATA_PATH: path.join(tempRoot, "userData"),
			RECORDINGS_DIR: path.join(tempRoot, "recordings"),
		}));
		vi.doMock("../state", () => ({
			approvedLocalReadPaths: new Set<string>(),
			currentProjectPath: null,
			currentVideoPath: null,
			setCurrentProjectPath: vi.fn(),
			setCurrentVideoPath: vi.fn(),
		}));

		const { registerExportHandlers } = await import("./export");
		registerExportHandlers();
	});

	afterEach(async () => {
		vi.resetModules();
		vi.doUnmock("electron");
		vi.doUnmock("../../appPaths");
		vi.doUnmock("../state");
		await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => undefined);
	});

	it("streams chunks, finalizes into an approved destination, and cleans the session dir", async () => {
		const { approveUserWritePath: registerDestination } = await import("../approvedPaths");
		registerDestination(destination);

		const opened = (await registry.invoke("export-stream-open", {
			extension: "mp4",
		})) as { success: boolean; streamId: string; tempPath: string };
		expect(opened.success).toBe(true);
		expect(await fs.access(opened.tempPath).then(() => true)).toBe(true);

		const first = Buffer.from("export-payload-");
		const second = Buffer.from("chunk-data");
		await registry.invoke(
			"export-stream-write",
			opened.streamId,
			0,
			new Uint8Array(first),
		);
		await registry.invoke(
			"export-stream-write",
			opened.streamId,
			first.length,
			new Uint8Array(second),
		);

		const closed = (await registry.invoke("export-stream-close", opened.streamId)) as {
			success: boolean;
			tempPath: string;
			bytesWritten: number;
		};
		expect(closed.success).toBe(true);
		expect(closed.bytesWritten).toBe(first.length + second.length);

		const finalized = (await registry.invoke("finalize-exported-video", {
			tempPath: closed.tempPath,
			fileName: "video.mp4",
			outputPath: destination,
		})) as { success: boolean; path: string; message: string };

		expect(finalized.success).toBe(true);
		expect(finalized.path).toBe(destination);

		// The destination holds the exact streamed bytes.
		const written = await fs.readFile(destination);
		expect(Buffer.concat([first, second]).equals(written)).toBe(true);

		// The temp file moved out of the session dir, which is now removed.
		await expect(fs.access(closed.tempPath)).rejects.toMatchObject({ code: "ENOENT" });
		const sessionDir = path.dirname(closed.tempPath);
		// removeExportSessionDirForTemp is fire-and-forget in the handler.
		await vi.waitFor(async () => {
			await expect(fs.access(sessionDir)).rejects.toMatchObject({ code: "ENOENT" });
		});

		// The moved temp path is no longer an owned export temp.
		const discard = (await registry.invoke("discard-exported-temp", closed.tempPath)) as {
			success: boolean;
			error: string;
		};
		expect(discard.success).toBe(false);
		expect(discard.error).toContain("not an app-managed export temp");
	});

	it("refuses finalize to destinations the app never approved", async () => {
		const opened = (await registry.invoke("export-stream-open", {
			extension: "mp4",
		})) as { streamId: string };
		await registry.invoke(
			"export-stream-write",
			opened.streamId,
			0,
			new Uint8Array(Buffer.from("x")),
		);
		const closed = (await registry.invoke("export-stream-close", opened.streamId)) as {
			tempPath: string;
		};

		const hostileDestination = path.join(tempRoot, "elsewhere", "evil.mp4");
		// The dialog branch reads event.sender; supply a mock event.
		const finalizeHandler = registry.getHandler("finalize-exported-video")!;
		const finalized = (await finalizeHandler(
			{ sender: { isDestroyed: () => false } },
			{
				tempPath: closed.tempPath,
				fileName: "video.mp4",
				outputPath: hostileDestination,
			},
		)) as { success: boolean; canceled: boolean };

		// The unapproved destination falls through to the save-dialog branch,
		// which reports cancellation and leaves the owned temp file in place.
		expect(finalized.success).toBe(false);
		expect(finalized.canceled).toBe(true);
		await expect(fs.access(closed.tempPath)).resolves.toBeUndefined();
	});

	it("discard-exported-temp removes the temp file and its session directory", async () => {
		const opened = (await registry.invoke("export-stream-open", {
			extension: "mp4",
		})) as { tempPath: string };

		const discarded = (await registry.invoke("discard-exported-temp", opened.tempPath)) as {
			success: boolean;
		};
		expect(discarded.success).toBe(true);
		await expect(fs.access(opened.tempPath)).rejects.toMatchObject({ code: "ENOENT" });
	});
});
