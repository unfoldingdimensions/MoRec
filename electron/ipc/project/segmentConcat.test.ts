import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Unit tests for the multi-clip segment concat (ffmpeg concat demuxer with
 * stream copy). execFile is mocked; the ffmpeg binary path is stubbed so the
 * suite stays hermetic. The important behavior is what happens around the
 * encode: the concat list file's contents/escaping, staging + move-over of
 * the primary path, source cleanup (kept + discarded + manifests), and the
 * failure paths leaving everything untouched.
 */

const execFileMock = vi.hoisted(() => vi.fn());
const ffmpegPathMock = vi.hoisted(() => ({ value: "/fake/ffmpeg" }));

vi.mock("node:child_process", () => ({
	execFile: (...args: unknown[]) => execFileMock(...args),
}));
vi.mock("../ffmpeg/binary", () => ({
	getFfmpegBinaryPath: () => ffmpegPathMock.value,
}));

import { buildConcatListEntry, concatRecordingSegments } from "./segmentConcat";

describe("buildConcatListEntry", () => {
	it("quotes paths for the concat demuxer, escaping single quotes", () => {
		expect(buildConcatListEntry("/rec/a.mp4")).toBe("file '/rec/a.mp4'");
		expect(buildConcatListEntry("/rec/my 'take'.mp4")).toBe(
			"file '/rec/my '\\''take'\\''.mp4'",
		);
	});
});

	describe("concatRecordingSegments", () => {
	let tempRoot: string;
	let primaryPath: string;
	let secondPath: string;
	let thirdPath: string;
	let lastConcatList: string;

	beforeEach(async () => {
		vi.clearAllMocks();
		execFileMock.mockReset();
		lastConcatList = "";
		tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "morec-concat-test-"));
		primaryPath = path.join(tempRoot, "recording-100.mp4");
		secondPath = path.join(tempRoot, "recording-200.mp4");
		thirdPath = path.join(tempRoot, "recording-300.mp4");
		for (const p of [primaryPath, secondPath, thirdPath]) {
			await fs.writeFile(p, "segment-bytes");
		}
		// "Concat output": replace the primary content with merged bytes.
		execFileMock.mockImplementation(
			(
				_cmd: unknown,
				args: string[],
				_opts: unknown,
				callback: (error: Error | null) => void,
			) => {
				const listIndex = args.indexOf("-i") + 1;
				void fs
					.readFile(args[listIndex], "utf-8")
					.then((list) => {
						lastConcatList = list;
						return fs.writeFile(
							args[args.length - 1],
							`merged:${list.includes("recording-100.mp4") ? "primary" : "unknown"}`,
						);
					})
					.then(() => callback(null));
			},
		);
	});

	it("merges kept segments over the primary and deletes all sources", async () => {
		const result = await concatRecordingSegments({
			outputPath: primaryPath,
			keep: [primaryPath, secondPath],
			discard: [thirdPath],
		});

		expect(result).toEqual({
			success: true,
			outputPath: primaryPath,
			keptCount: 2,
			droppedCount: 1,
		});

		// The primary now holds the merged output.
		await expect(fs.readFile(primaryPath, "utf-8")).resolves.toBe(
			"merged:primary",
		);
		// Every source segment is gone.
		await expect(fs.access(secondPath)).rejects.toMatchObject({ code: "ENOENT" });
		await expect(fs.access(thirdPath)).rejects.toMatchObject({ code: "ENOENT" });
		// No staging leftovers.
		const entries = await fs.readdir(tempRoot);
		expect(entries.filter((entry) => entry.includes("concat-"))).toEqual([]);
	});

	it("passes the concat demuxer arguments and list contents to ffmpeg", async () => {
		await concatRecordingSegments({
			outputPath: primaryPath,
			keep: [primaryPath, secondPath],
			discard: [],
		});

		expect(execFileMock).toHaveBeenCalledTimes(1);
		const [cmd, args] = execFileMock.mock.calls[0] as unknown as [string, string[]];
		expect(cmd).toBe("/fake/ffmpeg");
		expect(args.slice(0, 8)).toEqual([
			"-y",
			"-f",
			"concat",
			"-safe",
			"0",
			"-i",
			expect.stringContaining(".list.txt"),
			"-c",
		]);
		expect(args).toContain("copy");
		// The list referenced the kept segments in order (captured inside the
		// ffmpeg mock — the module deletes the list file on success).
		expect(lastConcatList).toBe(
			`file '${primaryPath}'\nfile '${secondPath}'\n`,
		);
	});

	it("cleans up per-segment session manifests of deleted sources", async () => {
		const manifestPath = secondPath.replace(/\.mp4$/, ".morec-session.json");
		await fs.writeFile(manifestPath, "{}", "utf-8");

		await concatRecordingSegments({
			outputPath: primaryPath,
			keep: [primaryPath, secondPath],
			discard: [],
		});

		await expect(fs.access(manifestPath)).rejects.toMatchObject({ code: "ENOENT" });
	});

	it("refuses an output path outside the kept list", async () => {
		const result = await concatRecordingSegments({
			outputPath: path.join(tempRoot, "unrelated.mp4"),
			keep: [primaryPath],
			discard: [],
		});
		expect(result).toMatchObject({ success: false });
		expect(execFileMock).not.toHaveBeenCalled();
	});

	it("leaves every source intact when the ffmpeg encode fails", async () => {
		execFileMock.mockImplementation(
			(
				_cmd: unknown,
				_args: unknown,
				_opts: unknown,
				callback: (error: Error | null) => void,
			) => {
				callback(new Error("encode boom"));
			},
		);

		const result = await concatRecordingSegments({
			outputPath: primaryPath,
			keep: [primaryPath, secondPath],
			discard: [thirdPath],
		});

		expect(result).toMatchObject({ success: false });
		expect(result.success ? "" : result.error).toContain("encode boom");
		// Sources are untouched.
		await expect(fs.readFile(primaryPath, "utf-8")).resolves.toBe("segment-bytes");
		await expect(fs.access(secondPath)).resolves.toBeUndefined();
		await expect(fs.access(thirdPath)).resolves.toBeUndefined();
	});
});
