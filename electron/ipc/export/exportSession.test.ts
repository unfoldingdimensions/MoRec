import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	buildResumableSegmentConcatLines,
	createExportSessionManifest,
	discardExportSession,
	getExportSessionDirPath,
	getExportSessionSegmentName,
	getExportSessionSegmentPath,
	getExportSessionsRootPath,
	isSafeExportSessionId,
	listExportSessionSegmentFiles,
	parseExportSessionManifest,
	planResumableSegmentWork,
	readExportSessionManifest,
	sweepStaleExportSessions,
	writeExportSessionManifest,
	type ExportSessionManifest,
} from "./exportSession";

let tempRoot: string;

beforeEach(async () => {
	tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "morec-export-session-"));
});

afterEach(async () => {
	await fs.rm(tempRoot, { force: true, recursive: true });
});

function makeChunks(count: number) {
	return Array.from({ length: count }, (_, index) => ({
		index,
		startSec: index * 120,
		durationSec: 120,
	}));
}

async function writeSession(params: {
	exportId: string;
	doneIndexes: number[];
	segmentCount?: number;
	updatedAt?: string;
}) {
	const sessionDir = getExportSessionDirPath(tempRoot, params.exportId);
	if (!sessionDir) {
		throw new Error("unreachable");
	}
	await fs.mkdir(sessionDir, { recursive: true });
	const manifest = createExportSessionManifest({
		exportId: params.exportId,
		settingsHash: "abc12345",
		segmentCount: params.segmentCount ?? 3,
	});
	for (const index of params.doneIndexes) {
		const name = getExportSessionSegmentName(index);
		await fs.writeFile(path.join(sessionDir, name), "segment-bytes");
		manifest.segments[String(index)] = {
			status: "done",
			file: name,
			bytes: 13,
			completedAt: new Date().toISOString(),
		};
	}
	if (params.updatedAt) {
		manifest.updatedAt = params.updatedAt;
		await writeExportSessionManifest(sessionDir, manifest);
		// writeExportSessionManifest stamps updatedAt itself; restore for the test.
		const raw = JSON.parse(
			await fs.readFile(path.join(sessionDir, "manifest.json"), "utf-8"),
		) as ExportSessionManifest;
		raw.updatedAt = params.updatedAt;
		await fs.writeFile(
			path.join(sessionDir, "manifest.json"),
			JSON.stringify(raw, null, 2),
			"utf-8",
		);
		return { sessionDir, manifest: raw };
	}
	await writeExportSessionManifest(sessionDir, manifest);
	return { sessionDir, manifest };
}

describe("export session ids and paths", () => {
	it("accepts safe ids and rejects traversal attempts", () => {
		expect(isSafeExportSessionId("morec-static-layout-1")).toBe(true);
		expect(isSafeExportSessionId("../escape")).toBe(false);
		expect(isSafeExportSessionId("a/b")).toBe(false);
		expect(isSafeExportSessionId("")).toBe(false);
		expect(isSafeExportSessionId(null)).toBe(false);
	});

	it("returns null session dirs for hostile ids", () => {
		expect(getExportSessionDirPath(tempRoot, "../../escape")).toBeNull();
		expect(getExportSessionDirPath(tempRoot, "morec-ok")).toBe(
			path.join(getExportSessionsRootPath(tempRoot), "morec-ok"),
		);
	});
});

describe("export session manifest round-trip", () => {
	it("writes and reads back a manifest with done segments", async () => {
		const { sessionDir, manifest } = await writeSession({
			exportId: "roundtrip-1",
			doneIndexes: [0, 2],
		});

		const readBack = await readExportSessionManifest(sessionDir);
		expect(readBack).not.toBeNull();
		expect(readBack?.exportId).toBe("roundtrip-1");
		expect(readBack?.settingsHash).toBe("abc12345");
		expect(readBack?.segmentCount).toBe(3);
		expect(Object.keys(readBack?.segments ?? {}).sort()).toEqual(["0", "2"]);
		expect(readBack?.segments["0"]).toMatchObject({
			status: "done",
			file: "segment-0000.mp4",
			bytes: 13,
		});
		expect(manifest.updatedAt).toBeTruthy();
	});

	it("returns null for a missing or corrupt manifest", async () => {
		const sessionDir = path.join(getExportSessionsRootPath(tempRoot), "empty-1");
		await fs.mkdir(sessionDir, { recursive: true });
		expect(await readExportSessionManifest(sessionDir)).toBeNull();

		await fs.writeFile(path.join(sessionDir, "manifest.json"), "{not json", "utf-8");
		expect(await readExportSessionManifest(sessionDir)).toBeNull();
	});

	it("rejects manifests with invalid shapes or segment entries", () => {
		expect(parseExportSessionManifest(null)).toBeNull();
		expect(parseExportSessionManifest({ version: 2 })).toBeNull();
		expect(
			parseExportSessionManifest({
				version: 1,
				exportId: "bad id/",
				settingsHash: "hash",
				segmentCount: 1,
				segments: {},
			}),
		).toBeNull();
		expect(
			parseExportSessionManifest({
				version: 1,
				exportId: "ok-id",
				settingsHash: "hash",
				segmentCount: 1,
				segments: { 0: { status: "done", file: "", bytes: -1, completedAt: "x" } },
			})?.segments,
		).toEqual({});
	});
});

describe("planResumableSegmentWork", () => {
	it("skips segments whose manifest entry and file are both present", async () => {
		const { sessionDir } = await writeSession({
			exportId: "plan-1",
			doneIndexes: [0, 2],
		});
		const manifest = await readExportSessionManifest(sessionDir);
		const existing = await listExportSessionSegmentFiles(sessionDir);

		const plan = planResumableSegmentWork({
			chunks: makeChunks(3),
			manifest,
			existingSegmentFiles: existing,
		});

		expect(plan.doneIndexes).toEqual([0, 2]);
		expect(plan.toRender).toEqual([{ index: 1, startSec: 120, durationSec: 120 }]);
	});

	it("re-renders a manifest-done segment whose file is missing", async () => {
		const { sessionDir } = await writeSession({
			exportId: "plan-2",
			doneIndexes: [0, 1, 2],
		});
		const manifest = await readExportSessionManifest(sessionDir);
		// Simulate the last segment file being lost (truncated disk, manual delete).
		await fs.rm(getExportSessionSegmentPath(sessionDir, 2));

		const plan = planResumableSegmentWork({
			chunks: makeChunks(3),
			manifest,
			existingSegmentFiles: await listExportSessionSegmentFiles(sessionDir),
		});

		expect(plan.doneIndexes).toEqual([0, 1]);
		expect(plan.toRender.map((chunk) => chunk.index)).toEqual([2]);
	});

	it("renders everything when no usable manifest exists", () => {
		const plan = planResumableSegmentWork({
			chunks: makeChunks(2),
			manifest: null,
			existingSegmentFiles: new Set(),
		});

		expect(plan.doneIndexes).toEqual([]);
		expect(plan.toRender.map((chunk) => chunk.index)).toEqual([0, 1]);
	});
});

describe("buildResumableSegmentConcatLines", () => {
	it("lists every segment in order with mixed done and pending segments", () => {
		const sessionDir = path.join(getExportSessionsRootPath(tempRoot), "concat-1");
		const lines = buildResumableSegmentConcatLines(sessionDir, 4);

		expect(lines).toEqual([
			`file '${path.join(sessionDir, "segment-0000.mp4").replace(/\\/g, "/")}'`,
			`file '${path.join(sessionDir, "segment-0001.mp4").replace(/\\/g, "/")}'`,
			`file '${path.join(sessionDir, "segment-0002.mp4").replace(/\\/g, "/")}'`,
			`file '${path.join(sessionDir, "segment-0003.mp4").replace(/\\/g, "/")}'`,
		]);
	});

	it("keeps zero-padded names sortable for 10+ segments", () => {
		expect(getExportSessionSegmentName(9)).toBe("segment-0009.mp4");
		expect(getExportSessionSegmentName(10)).toBe("segment-0010.mp4");
	});
});

describe("sweepStaleExportSessions", () => {
	const DAY = 24 * 60 * 60 * 1000;

	it("removes sessions older than the max age and keeps fresh ones", async () => {
		await writeSession({
			exportId: "stale-1",
			doneIndexes: [0],
			updatedAt: new Date(Date.now() - 8 * DAY).toISOString(),
		});
		await writeSession({
			exportId: "fresh-1",
			doneIndexes: [0],
			updatedAt: new Date(Date.now() - 1 * DAY).toISOString(),
		});

		const result = await sweepStaleExportSessions({
			sessionsRoot: getExportSessionsRootPath(tempRoot),
		});

		expect(result.removed).toEqual(["stale-1"]);
		await expect(
			fs.access(path.join(getExportSessionsRootPath(tempRoot), "stale-1")),
		).rejects.toThrow();
		await expect(
			fs.access(path.join(getExportSessionsRootPath(tempRoot), "fresh-1")),
		).resolves.toBeUndefined();
	});

	it("sweeps manifest-less dirs by their newest file mtime", async () => {
		const orphanDir = path.join(getExportSessionsRootPath(tempRoot), "orphan-1");
		await fs.mkdir(orphanDir, { recursive: true });
		const oldTime = new Date(Date.now() - 9 * DAY);
		await fs.utimes(orphanDir, oldTime, oldTime);

		const result = await sweepStaleExportSessions({
			sessionsRoot: getExportSessionsRootPath(tempRoot),
		});

		expect(result.removed).toEqual(["orphan-1"]);
	});

	it("never removes sessions inside the max-age window", async () => {
		const { sessionDir } = await writeSession({
			exportId: "recent-1",
			doneIndexes: [0],
			updatedAt: new Date(Date.now() - 6.5 * DAY).toISOString(),
		});

		const result = await sweepStaleExportSessions({
			sessionsRoot: getExportSessionsRootPath(tempRoot),
			maxAgeMs: 7 * DAY,
		});

		expect(result.removed).toEqual([]);
		await expect(fs.access(sessionDir)).resolves.toBeUndefined();
	});

	it("tolerates a missing sessions root", async () => {
		const result = await sweepStaleExportSessions({
			sessionsRoot: path.join(tempRoot, "does-not-exist"),
		});
		expect(result.removed).toEqual([]);
	});
});

describe("discardExportSession", () => {
	it("removes the session dir recursively", async () => {
		const { sessionDir } = await writeSession({
			exportId: "discard-1",
			doneIndexes: [0, 1],
		});
		expect(await discardExportSession(sessionDir)).toBe(true);
		await expect(fs.access(sessionDir)).rejects.toThrow();
	});
});
