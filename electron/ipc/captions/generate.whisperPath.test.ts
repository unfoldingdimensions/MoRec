import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Security tests for the renderer-supplied Whisper executable path.
 *
 * `resolveWhisperExecutablePath` execFile's its return value, so a
 * renderer-supplied preferred path may only be used when the user granted
 * EXECUTION consent for it (`approvedLocalExecutablePaths`, populated solely by
 * the native "Select Whisper Executable" dialog). Read consent
 * (`approvedLocalReadPaths`, populated by media pickers) must never qualify —
 * a user can be talked into picking a disguised executable as "media" — and
 * the exec set must be a Set of its own so a read-path session rebuild cannot
 * grant or revoke execution consent.
 */
describe("resolveWhisperExecutablePath execution-consent gate", () => {
	let tempRoot: string;
	let fakeExecutablePath: string;
	let spawnSyncMock: ReturnType<typeof vi.fn>;
	let savedWhisperCppPathEnv: string | undefined;

	beforeEach(async () => {
		tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "morec-whisper-gate-"));
		fakeExecutablePath = path.join(tempRoot, "fake-whisper.exe");
		await fs.writeFile(fakeExecutablePath, "definitely not a real whisper binary");
		// POSIX X_OK is a real permission bit (Windows maps it to a read check),
		// so the fake binary must be executable for the gate's own check to pass.
		await fs.chmod(fakeExecutablePath, 0o755);

		savedWhisperCppPathEnv = process.env["WHISPER_CPP_PATH"];
		delete process.env["WHISPER_CPP_PATH"];

		vi.resetModules();
		vi.doMock("electron", () => ({
			app: {
				isPackaged: false,
				getPath: () => tempRoot,
				setPath: () => undefined,
				getAppPath: () => tempRoot,
			},
		}));
		// Hermetic bundled candidates: none, so only the preferred path can ever
		// match and every test fails closed unless the exec gate opens it.
		vi.doMock("../paths/binaries", () => ({
			getBundledWhisperExecutableCandidates: () => [],
		}));
		// Hermetic PATH lookup: the where/which step finds nothing.
		spawnSyncMock = vi.fn(() => ({ status: 1, stdout: "", stderr: "" }));
		vi.doMock("node:child_process", async (importOriginal) => {
			const actual = await importOriginal<typeof import("node:child_process")>();
			return { ...actual, spawnSync: spawnSyncMock };
		});
	});

	afterEach(async () => {
		vi.resetModules();
		vi.doUnmock("electron");
		vi.doUnmock("../paths/binaries");
		vi.doUnmock("node:child_process");
		if (savedWhisperCppPathEnv === undefined) {
			delete process.env["WHISPER_CPP_PATH"];
		} else {
			process.env["WHISPER_CPP_PATH"] = savedWhisperCppPathEnv;
		}
		await fs.rm(tempRoot, { recursive: true, force: true });
	});

	it("fails closed on an unapproved preferred path and falls through to the fallback candidates", async () => {
		const { resolveWhisperExecutablePath } = await import("./generate");

		// The file exists and is readable/executable, so only the missing
		// execution consent can disqualify it. With no other candidate present,
		// the lookup exhausts bundled/env/PATH candidates and throws.
		await expect(resolveWhisperExecutablePath(fakeExecutablePath)).rejects.toThrow(
			/No Whisper runtime/,
		);
		// The fall-through actually ran: the PATH lookup was consulted.
		expect(spawnSyncMock).toHaveBeenCalled();
	});

	it("uses the preferred path once the user granted execution consent for it", async () => {
		const { approveUserExecutablePath } = await import("../utils");
		const { resolveWhisperExecutablePath } = await import("./generate");

		approveUserExecutablePath(fakeExecutablePath);

		// A non-canonical spelling of the same file resolves to the approved
		// path and is returned as the executable to run.
		const requestPath = path.join(tempRoot, ".", "fake-whisper.exe");
		await expect(resolveWhisperExecutablePath(requestPath)).resolves.toBe(
			path.resolve(fakeExecutablePath),
		);
	});

	it("REGRESSION: read consent alone (media pickers) never authorizes execution", async () => {
		const { approveUserPath } = await import("../utils");
		const { approvedLocalReadPaths } = await import("../state");
		const { resolveWhisperExecutablePath } = await import("./generate");

		approveUserPath(fakeExecutablePath);
		// Read consent was genuinely recorded — the path sits in the read set.
		expect(approvedLocalReadPaths.has(path.resolve(fakeExecutablePath))).toBe(true);

		// ...but read consent must not make it the executable.
		await expect(resolveWhisperExecutablePath(fakeExecutablePath)).rejects.toThrow(
			/No Whisper runtime/,
		);
	});

	it("keeps execution consent in its own set that read-path rebuilds cannot touch", async () => {
		const { approvedLocalExecutablePaths, approvedLocalReadPaths } = await import("../state");
		const { approveUserExecutablePath } = await import("../utils");
		const { resolveWhisperExecutablePath } = await import("./generate");

		// Structural: the gate reads a DIFFERENT Set than the read-consent set.
		// `replaceApprovedSessionLocalReadPaths` clears and refills
		// approvedLocalReadPaths in place, so instance separation is what keeps a
		// session rebuild from silently revoking (or granting) exec consent.
		expect(approvedLocalExecutablePaths).not.toBe(approvedLocalReadPaths);

		approveUserExecutablePath(fakeExecutablePath);
		expect(approvedLocalExecutablePaths.has(path.resolve(fakeExecutablePath))).toBe(true);
		expect(approvedLocalReadPaths.has(path.resolve(fakeExecutablePath))).toBe(false);

		// Simulate the manager's read-set rebuild primitive directly on the shared
		// read set (clear + refill), without importing the F1-owned manager module.
		approvedLocalReadPaths.clear();
		approvedLocalReadPaths.add(path.join(tempRoot, "rebuilt-take.mp4"));

		// Execution consent survives the rebuild.
		await expect(resolveWhisperExecutablePath(fakeExecutablePath)).resolves.toBe(
			path.resolve(fakeExecutablePath),
		);
	});
});
