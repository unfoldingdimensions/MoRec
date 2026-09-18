import fs from "node:fs/promises";
import path from "node:path";
import { writeProjectFileAtomically } from "../project/atomicSave";

export const EXPORT_SESSIONS_DIRNAME = "export-session";
const MANIFEST_FILENAME = "manifest.json";
/** Session dirs older than this are removed at editor start. */
export const EXPORT_SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
// Mirrors the session-id validation in export/native-video.ts: ids flow into
// temp-directory paths, so only safe filename characters are accepted.
const SAFE_EXPORT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export interface ExportSessionSegmentEntry {
	status: "done";
	file: string;
	bytes: number;
	backend?: string;
	completedAt: string;
}

export interface ExportSessionManifest {
	version: 1;
	exportId: string;
	/** Renderer-computed hash of the export settings this session belongs to. */
	settingsHash: string;
	segmentCount: number;
	segments: Record<string, ExportSessionSegmentEntry>;
	createdAt: string;
	updatedAt: string;
}

export function isSafeExportSessionId(exportId: unknown): exportId is string {
	return (
		typeof exportId === "string" &&
		exportId.length <= 128 &&
		SAFE_EXPORT_ID_PATTERN.test(exportId)
	);
}

export function getExportSessionsRootPath(tempRoot: string): string {
	return path.join(path.resolve(tempRoot), EXPORT_SESSIONS_DIRNAME);
}

/**
 * Session dirs live under `<temp>/export-session/<exportId>/`. Callers must
 * pass an id that already passed `isSafeExportSessionId`; the resolve-based
 * boundary check below keeps a hostile id from escaping the root even then.
 */
export function getExportSessionDirPath(tempRoot: string, exportId: string): string | null {
	if (!isSafeExportSessionId(exportId)) {
		return null;
	}
	const resolvedRoot = getExportSessionsRootPath(tempRoot);
	const sessionDir = path.resolve(resolvedRoot, exportId);
	if (sessionDir !== resolvedRoot && !sessionDir.startsWith(resolvedRoot + path.sep)) {
		return null;
	}
	return sessionDir;
}

export function getExportSessionSegmentPath(sessionDir: string, index: number): string {
	return path.join(sessionDir, `segment-${String(index).padStart(4, "0")}.mp4`);
}

export function getExportSessionSegmentName(index: number): string {
	return `segment-${String(index).padStart(4, "0")}.mp4`;
}

export function createExportSessionManifest(params: {
	exportId: string;
	settingsHash: string;
	segmentCount: number;
}): ExportSessionManifest {
	const now = new Date().toISOString();
	return {
		version: 1,
		exportId: params.exportId,
		settingsHash: params.settingsHash,
		segmentCount: params.segmentCount,
		segments: {},
		createdAt: now,
		updatedAt: now,
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function parseSegmentEntry(value: unknown): ExportSessionSegmentEntry | null {
	if (!isRecord(value)) {
		return null;
	}
	if (value.status !== "done") {
		return null;
	}
	if (typeof value.file !== "string" || value.file.length === 0) {
		return null;
	}
	if (typeof value.bytes !== "number" || !Number.isFinite(value.bytes) || value.bytes <= 0) {
		return null;
	}
	if (typeof value.completedAt !== "string") {
		return null;
	}

	return {
		status: "done",
		file: value.file,
		bytes: value.bytes,
		backend: typeof value.backend === "string" ? value.backend : undefined,
		completedAt: value.completedAt,
	};
}

export function parseExportSessionManifest(raw: unknown): ExportSessionManifest | null {
	if (!isRecord(raw)) {
		return null;
	}
	if (raw.version !== 1) {
		return null;
	}
	if (!isSafeExportSessionId(raw.exportId)) {
		return null;
	}
	if (typeof raw.settingsHash !== "string" || raw.settingsHash.length === 0) {
		return null;
	}
	if (typeof raw.segmentCount !== "number" || !Number.isInteger(raw.segmentCount)) {
		return null;
	}
	if (!isRecord(raw.segments)) {
		return null;
	}

	const segments: Record<string, ExportSessionSegmentEntry> = {};
	for (const [key, value] of Object.entries(raw.segments)) {
		if (!/^\d+$/.test(key)) {
			continue;
		}
		const entry = parseSegmentEntry(value);
		if (entry) {
			segments[key] = entry;
		}
	}

	return {
		version: 1,
		exportId: raw.exportId,
		settingsHash: raw.settingsHash,
		segmentCount: raw.segmentCount,
		segments,
		createdAt: typeof raw.createdAt === "string" ? raw.createdAt : new Date().toISOString(),
		updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : new Date().toISOString(),
	};
}

export function getManifestPath(sessionDir: string): string {
	return path.join(sessionDir, MANIFEST_FILENAME);
}

export async function readExportSessionManifest(
	sessionDir: string,
): Promise<ExportSessionManifest | null> {
	try {
		const raw = await fs.readFile(getManifestPath(sessionDir), "utf-8");
		return parseExportSessionManifest(JSON.parse(raw));
	} catch {
		return null;
	}
}

/**
 * Manifest updates must survive crashes mid-write, so the same atomic
 * write-temp-then-rename strategy as project files applies here.
 */
export async function writeExportSessionManifest(
	sessionDir: string,
	manifest: ExportSessionManifest,
): Promise<void> {
	const next: ExportSessionManifest = {
		...manifest,
		updatedAt: new Date().toISOString(),
	};
	await writeProjectFileAtomically(
		getManifestPath(sessionDir),
		`${JSON.stringify(next, null, 2)}\n`,
	);
}

export interface ResumableSegmentPlan {
	/** Segment indexes with a manifest entry whose file still exists. */
	doneIndexes: number[];
	/** Segments that still need to be rendered. */
	toRender: Array<{ index: number; startSec: number; durationSec: number }>;
}

/**
 * Pure decision core of the resume flow: a manifest entry only counts as done
 * when its segment file is still on disk, so a partially-truncated session
 * re-renders what is missing instead of concat-ing a gap.
 */
export function planResumableSegmentWork({
	chunks,
	manifest,
	existingSegmentFiles,
}: {
	chunks: Array<{ index: number; startSec: number; durationSec: number }>;
	manifest: ExportSessionManifest | null;
	existingSegmentFiles: Set<string>;
}): ResumableSegmentPlan {
	const doneIndexes: number[] = [];
	const toRender: ResumableSegmentPlan["toRender"] = [];

	for (const chunk of chunks) {
		const entry = manifest?.segments[String(chunk.index)];
		const fileName = getExportSessionSegmentName(chunk.index);
		if (entry && entry.file === fileName && existingSegmentFiles.has(fileName)) {
			doneIndexes.push(chunk.index);
		} else {
			toRender.push(chunk);
		}
	}

	return { doneIndexes, toRender };
}

/**
 * The concat list must always cover every segment in timeline order — done
 * segments from a previous run and freshly rendered ones alike — so the
 * resumed output is identical to an uninterrupted render.
 */
export function buildResumableSegmentConcatLines(
	sessionDir: string,
	segmentCount: number,
): string[] {
	const lines: string[] = [];
	for (let index = 0; index < segmentCount; index++) {
		lines.push(toConcatFileLine(getExportSessionSegmentPath(sessionDir, index)));
	}
	return lines;
}

function toConcatFileLine(filePath: string) {
	const normalized = filePath.replace(/\\/g, "/").replace(/'/g, "'\\''");
	return `file '${normalized}'`;
}

export async function listExportSessionSegmentFiles(sessionDir: string): Promise<Set<string>> {
	try {
		const entries = await fs.readdir(sessionDir);
		return new Set(entries.filter((name) => /^segment-\d{4}\.mp4$/.test(name)));
	} catch {
		return new Set();
	}
}

export async function discardExportSession(sessionDir: string): Promise<boolean> {
	// The session dir is always constructed by getExportSessionDirPath, but
	// re-check the root boundary before removing anything recursively.
	const resolvedRoot = path.resolve(path.dirname(sessionDir));
	if (path.basename(resolvedRoot) !== EXPORT_SESSIONS_DIRNAME) {
		return false;
	}
	await fs.rm(sessionDir, { force: true, recursive: true });
	return true;
}

/**
 * Removes session dirs whose last manifest update is older than `maxAgeMs`
 * (default 7 days). Sessions without a readable manifest fall back to the
 * newest file mtime, so orphaned dirs from ancient versions are swept too.
 */
export async function sweepStaleExportSessions({
	sessionsRoot,
	nowMs = Date.now(),
	maxAgeMs = EXPORT_SESSION_MAX_AGE_MS,
}: {
	sessionsRoot: string;
	nowMs?: number;
	maxAgeMs?: number;
}): Promise<{ removed: string[] }> {
	const removed: string[] = [];
	const resolvedRoot = path.resolve(sessionsRoot);
	let entries: string[];
	try {
		entries = await fs.readdir(sessionsRoot);
	} catch {
		return { removed };
	}

	for (const entry of entries) {
		// readdir yields basenames, but session dirs are app-generated ids only —
		// reject anything else so the joined path can never leave the root.
		if (!isSafeExportSessionId(entry)) {
			continue;
		}
		const sessionDir = path.resolve(resolvedRoot, entry);
		if (sessionDir !== resolvedRoot && !sessionDir.startsWith(resolvedRoot + path.sep)) {
			continue;
		}
		const stat = await fs.stat(sessionDir).catch(() => null);
		if (!stat?.isDirectory()) {
			continue;
		}

		const manifest = await readExportSessionManifest(sessionDir);
		let lastActivityMs = stat.mtimeMs;
		if (manifest) {
			const parsedUpdatedAt = Date.parse(manifest.updatedAt);
			if (Number.isFinite(parsedUpdatedAt)) {
				lastActivityMs = parsedUpdatedAt;
			}
		} else {
			const files = await fs.readdir(sessionDir).catch(() => [] as string[]);
			for (const file of files) {
				const fileStat = await fs.stat(path.join(sessionDir, file)).catch(() => null);
				if (fileStat && fileStat.mtimeMs > lastActivityMs) {
					lastActivityMs = fileStat.mtimeMs;
				}
			}
		}

		if (nowMs - lastActivityMs > maxAgeMs) {
			if (await discardExportSession(sessionDir)) {
				removed.push(entry);
			}
		}
	}

	return { removed };
}
