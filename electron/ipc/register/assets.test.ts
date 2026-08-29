import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IpcRegistry } from "../../test/ipcRegistry";

/**
 * Handler-level tests for `register/assets.ts`, focusing on the
 * read-local-file allowlist: unapproved paths are rejected, app-approved
 * paths (dialog-picked files, recordings, app-managed dirs) are readable.
 */
const mocks = {
	isAllowedLocalReadPath: vi.fn(),
	approveUserPath: vi.fn(),
};

describe("register/assets read-local-file gate", () => {
	const registry = new IpcRegistry();
	let tempRoot: string;
	let approvedFile: string;
	let unapprovedFile: string;

	beforeEach(async () => {
		vi.resetModules();
		registry.reset();
		registry.installElectronMock();

		for (const fn of Object.values(mocks)) {
			fn.mockReset();
		}

		tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "morec-assets-test-"));
		approvedFile = path.join(tempRoot, "approved.png");
		unapprovedFile = path.join(tempRoot, "unapproved.png");
		await fs.writeFile(approvedFile, "approved-bytes", "utf-8");
		await fs.writeFile(unapprovedFile, "secret-bytes", "utf-8");

		vi.doMock("../../appPaths", () => ({ USER_DATA_PATH: path.join(tempRoot, "userData") }));
		vi.doMock("../utils", async (importOriginal) => {
			const actual = await importOriginal<typeof import("../utils")>();
			return { ...actual, approveUserPath: mocks.approveUserPath };
		});
		vi.doMock("../project/manager", () => ({
			isAllowedLocalReadPath: mocks.isAllowedLocalReadPath,
			getAssetRootPath: () => path.join(tempRoot, "assets"),
		}));

		const { registerAssetHandlers } = await import("./assets");
		registerAssetHandlers();
	});

	afterEach(async () => {
		vi.resetModules();
		vi.doUnmock("electron");
		vi.doUnmock("../../appPaths");
		vi.doUnmock("../utils");
		vi.doUnmock("../project/manager");
		await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => undefined);
	});

	it("reads an approved file", async () => {
		mocks.isAllowedLocalReadPath.mockReturnValue(true);

		const result = (await registry.invoke("read-local-file", approvedFile)) as {
			success: boolean;
			data: ArrayBuffer;
		};
		expect(result.success).toBe(true);
		expect(Buffer.from(result.data).toString("utf-8")).toBe("approved-bytes");
	});

	it("rejects unapproved paths without reading them", async () => {
		mocks.isAllowedLocalReadPath.mockReturnValue(false);

		const result = (await registry.invoke("read-local-file", unapprovedFile)) as {
			success: boolean;
			error: string;
		};
		expect(result.success).toBe(false);
		expect(result.error).toContain("not approved for local reads");
	});

	it("rejects missing files even when the path would be approved", async () => {
		mocks.isAllowedLocalReadPath.mockReturnValue(true);

		const result = (await registry.invoke(
			"read-local-file",
			path.join(tempRoot, "missing.png"),
		)) as { success: boolean; error: string };
		expect(result.success).toBe(false);
	});

	it("rejects directories", async () => {
		mocks.isAllowedLocalReadPath.mockReturnValue(true);

		const result = (await registry.invoke("read-local-file", tempRoot)) as {
			success: boolean;
			error: string;
		};
		expect(result.success).toBe(false);
		expect(result.error).toContain("not a readable file");
	});

	it("reports cancellation from the image file picker", async () => {
		const electron = await import("electron");
		(electron.dialog.showOpenDialog as ReturnType<typeof vi.fn>).mockResolvedValue({
			canceled: true,
			filePaths: [],
		});

		expect(await registry.invoke("open-image-file-picker")).toEqual({
			success: false,
			canceled: true,
		});
		expect(mocks.approveUserPath).not.toHaveBeenCalled();
	});

	it("approves image picker results so the renderer can read them back", async () => {
		const electron = await import("electron");
		(electron.dialog.showOpenDialog as ReturnType<typeof vi.fn>).mockResolvedValue({
			canceled: false,
			filePaths: [approvedFile],
		});

		expect(await registry.invoke("open-image-file-picker")).toEqual({
			success: true,
			path: approvedFile,
		});
		expect(mocks.approveUserPath).toHaveBeenCalledWith(approvedFile);
	});
});
