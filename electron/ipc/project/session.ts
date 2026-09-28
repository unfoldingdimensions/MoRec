import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { RECORDING_SESSION_MANIFEST_SUFFIX } from "../constants";
import type { RecordingSessionData, RecordingSessionManifest } from "../types";
import { writeProjectFileAtomically } from "./atomicSave";
import { normalizeVideoSourcePath, parseJsonWithByteOrderMark } from "../utils";

function normalizeRecordingTimeOffsetMs(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value) ? Math.round(value) : 0;
}

/**
 * Marks from the manifest are normalized: finite, non-negative, ascending,
 * deduplicated (a mark within 500 ms of its predecessor is a double-tap) and
 * stripped of a meaningless 0:00 mark.
 */
export function normalizeRecordingMarks(value: unknown, durationMs?: number): number[] {
	if (!Array.isArray(value)) {
		return [];
	}
	const clampTo = Number.isFinite(durationMs) && (durationMs ?? 0) > 0 ? durationMs! : null;
	const normalized: number[] = [];
	for (const entry of value) {
		if (typeof entry !== "number" || !Number.isFinite(entry)) {
			continue;
		}
		const markMs = Math.round(entry);
		if (markMs < 250) {
			continue;
		}
		if (clampTo !== null && markMs >= clampTo) {
			continue;
		}
		const previous = normalized[normalized.length - 1];
		if (previous !== undefined && markMs - previous < 500) {
			continue;
		}
		normalized.push(markMs);
	}
	return normalized;
}

// The manifest sits next to the video and can be written by anything that
// can touch the folder, so only a plain filename inside the video's own
// directory may ever be re-linked.
function isPlainFileName(value: string): boolean {
	return (
		value.length > 0 &&
		value !== "." &&
		value !== ".." &&
		!value.includes("/") &&
		!value.includes("\\") &&
		path.basename(value) === value
	);
}

export function getRecordingSessionManifestPath(videoPath: string) {
	const extension = path.extname(videoPath);
	const baseName = path.basename(videoPath, extension);
	return path.join(path.dirname(videoPath), `${baseName}${RECORDING_SESSION_MANIFEST_SUFFIX}`);
}

/** Segment file names from the manifest: only plain in-directory names survive. */
export function normalizeSegmentFileNames(value: unknown): string[] {
	if (!Array.isArray(value)) {
		return [];
	}
	const normalized: string[] = [];
	for (const entry of value) {
		if (typeof entry === "string" && isPlainFileName(entry.trim())) {
			normalized.push(entry.trim());
		}
	}
	return normalized;
}

export async function persistRecordingSessionManifest(
	session: RecordingSessionData,
): Promise<void> {
	const normalizedVideoPath = normalizeVideoSourcePath(session.videoPath);
	if (!normalizedVideoPath) {
		return;
	}

	const normalizedWebcamPath = normalizeVideoSourcePath(session.webcamPath ?? null);
	const manifestPath = getRecordingSessionManifestPath(normalizedVideoPath);
	const marksMs = normalizeRecordingMarks(session.marksMs, undefined);
	const segmentFiles = normalizeSegmentFileNames(session.segmentFiles);

	if (!normalizedWebcamPath && marksMs.length === 0 && segmentFiles.length === 0) {
		await fs.rm(manifestPath, { force: true });
		return;
	}

	// v5: a webcam-less recording keeps a manifest when it carries marks or
	// segment rollovers — those are the session's only durable extra state.
	const manifest: RecordingSessionManifest = {
		version: 5,
		videoFileName: path.basename(normalizedVideoPath),
		...(normalizedWebcamPath ? { webcamFileName: path.basename(normalizedWebcamPath) } : {}),
		timeOffsetMs: normalizeRecordingTimeOffsetMs(session.timeOffsetMs),
		hideOverlayCursorByDefault: session.hideOverlayCursorByDefault === true,
		...(marksMs.length > 0 ? { marksMs } : {}),
		...(segmentFiles.length > 0 ? { segmentFiles } : {}),
	};

	// The manifest is the only durable record of the webcam link, its sync
	// offset, and the multi-clip marks/segments, and it is most likely to be
	// mid-write during the exact crash it exists to survive — commit it
	// through the temp+rename writer.
	await writeProjectFileAtomically(manifestPath, JSON.stringify(manifest, null, 2));
}

/**
 * Shared merge for mid-recording manifest writes: preserve whatever session
 * state an existing manifest already carries (webcam link, sync offset,
 * cursor flag) and write the given marks/segments into a v5 manifest.
 */
async function persistInFlightSessionManifest(
	videoPath: string,
	extras: { marksMs?: number[]; segmentFiles?: string[] },
): Promise<void> {
	const normalizedVideoPath = normalizeVideoSourcePath(videoPath);
	const marksMs = normalizeRecordingMarks(extras.marksMs, undefined);
	const segmentFiles = normalizeSegmentFileNames(extras.segmentFiles);
	if (!normalizedVideoPath || (marksMs.length === 0 && segmentFiles.length === 0)) {
		return;
	}

	const manifestPath = getRecordingSessionManifestPath(normalizedVideoPath);
	let webcamFileName: string | undefined;
	let timeOffsetMs = 0;
	let hideOverlayCursorByDefault = false;

	try {
		const content = await fs.readFile(manifestPath, "utf-8");
		const parsed = parseJsonWithByteOrderMark<Partial<RecordingSessionManifest>>(content);
		if (
			parsed.version === 1 ||
			parsed.version === 2 ||
			parsed.version === 3 ||
			parsed.version === 4 ||
			parsed.version === 5
		) {
			if (typeof parsed.webcamFileName === "string" && isPlainFileName(parsed.webcamFileName)) {
				webcamFileName = parsed.webcamFileName;
			}
			timeOffsetMs = normalizeRecordingTimeOffsetMs(parsed.timeOffsetMs);
			hideOverlayCursorByDefault = parsed.hideOverlayCursorByDefault === true;
		}
	} catch {
		// No existing manifest — start from the minimal shape.
	}

	const manifest: RecordingSessionManifest = {
		version: 5,
		videoFileName: path.basename(normalizedVideoPath),
		...(webcamFileName ? { webcamFileName } : {}),
		timeOffsetMs,
		hideOverlayCursorByDefault,
		...(marksMs.length > 0 ? { marksMs } : {}),
		...(segmentFiles.length > 0 ? { segmentFiles } : {}),
	};

	await writeProjectFileAtomically(manifestPath, JSON.stringify(manifest, null, 2));
}

/**
 * Mid-recording mark persistence: merges the new marks into any manifest
 * already sitting next to the target video (preserving a webcam link written
 * by an earlier session lifecycle) or creates a minimal marks-only manifest.
 * Called per-mark so marks survive a crash before recording stops.
 */
export async function persistRecordingMarksManifest(
	videoPath: string,
	marksMs: number[],
): Promise<void> {
	await persistInFlightSessionManifest(videoPath, { marksMs });
}

/**
 * Per-rollover segment persistence: records the finalized segment file
 * names so a crash between rollovers still leaves every completed segment
 * discoverable. Anchored to the primary (first segment) path.
 */
export async function persistRecordingSegmentsManifest(
	videoPath: string,
	segmentFiles: string[],
): Promise<void> {
	await persistInFlightSessionManifest(videoPath, { segmentFiles });
}

export async function resolveRecordingSessionManifest(
	videoPath?: string | null,
): Promise<RecordingSessionData | null> {
	const normalizedVideoPath = normalizeVideoSourcePath(videoPath);
	if (!normalizedVideoPath) {
		return null;
	}

	const manifestPath = getRecordingSessionManifestPath(normalizedVideoPath);

	try {
		const content = await fs.readFile(manifestPath, "utf-8");
		const parsed = parseJsonWithByteOrderMark<Partial<RecordingSessionManifest>>(content);
		if (
			parsed.version !== 1 &&
			parsed.version !== 2 &&
			parsed.version !== 3 &&
			parsed.version !== 4 &&
			parsed.version !== 5
		) {
			return null;
		}

		const marksMs = normalizeRecordingMarks(parsed.marksMs, undefined);
		const segmentFiles = normalizeSegmentFileNames(parsed.segmentFiles);
		const webcamFileName =
			typeof parsed.webcamFileName === "string" && parsed.webcamFileName.trim()
				? parsed.webcamFileName.trim()
				: null;

		if (webcamFileName && !isPlainFileName(webcamFileName)) {
			// A traversal or absolute path in the manifest must not become a
			// read-approved webcam link; keep the offset but drop the link.
			return {
				videoPath: normalizedVideoPath,
				webcamPath: null,
				timeOffsetMs: normalizeRecordingTimeOffsetMs(parsed.timeOffsetMs),
				hideOverlayCursorByDefault: parsed.hideOverlayCursorByDefault === true,
				...(marksMs.length > 0 ? { marksMs } : {}),
				...(segmentFiles.length > 0 ? { segmentFiles } : {}),
			};
		}

		if (!webcamFileName) {
			return {
				videoPath: normalizedVideoPath,
				webcamPath: null,
				timeOffsetMs: normalizeRecordingTimeOffsetMs(parsed.timeOffsetMs),
				hideOverlayCursorByDefault: parsed.hideOverlayCursorByDefault === true,
				...(marksMs.length > 0 ? { marksMs } : {}),
				...(segmentFiles.length > 0 ? { segmentFiles } : {}),
			};
		}

		const webcamPath = path.join(path.dirname(normalizedVideoPath), webcamFileName);
		const webcamExists = await fs
			.access(webcamPath, fsConstants.F_OK)
			.then(() => true)
			.catch(() => false);

		return {
			videoPath: normalizedVideoPath,
			webcamPath: webcamExists ? webcamPath : null,
			timeOffsetMs: normalizeRecordingTimeOffsetMs(parsed.timeOffsetMs),
			hideOverlayCursorByDefault: parsed.hideOverlayCursorByDefault === true,
			...(marksMs.length > 0 ? { marksMs } : {}),
			...(segmentFiles.length > 0 ? { segmentFiles } : {}),
		};
	} catch {
		return null;
	}
}

export async function resolveLinkedWebcamPath(videoPath?: string | null): Promise<string | null> {
	const normalizedVideoPath = normalizeVideoSourcePath(videoPath);
	if (!normalizedVideoPath) {
		return null;
	}

	const extension = path.extname(normalizedVideoPath);
	const baseName = path.basename(normalizedVideoPath, extension);
	if (!baseName || baseName.endsWith("-webcam")) {
		return null;
	}

	const candidateExtensions = Array.from(
		new Set([extension, ".webm", ".mp4", ".mov", ".mkv", ".avi"].filter(Boolean)),
	);

	for (const candidateExtension of candidateExtensions) {
		const candidatePath = path.join(
			path.dirname(normalizedVideoPath),
			`${baseName}-webcam${candidateExtension}`,
		);

		try {
			await fs.access(candidatePath, fsConstants.F_OK);
			return candidatePath;
		} catch {
			continue;
		}
	}

	return null;
}

export async function resolveRecordingSession(
	videoPath?: string | null,
): Promise<RecordingSessionData | null> {
	const manifestSession = await resolveRecordingSessionManifest(videoPath);
	if (manifestSession) {
		// A marks/segments-only crash write can predate the webcam sidecar;
		// keep the established sibling auto-discovery for the webcam link.
		if (
			!manifestSession.webcamPath &&
			((manifestSession.marksMs?.length ?? 0) > 0 ||
				(manifestSession.segmentFiles?.length ?? 0) > 0)
		) {
			const linkedWebcamPath = await resolveLinkedWebcamPath(manifestSession.videoPath);
			if (linkedWebcamPath) {
				return { ...manifestSession, webcamPath: linkedWebcamPath };
			}
		}
		return manifestSession;
	}

	const normalizedVideoPath = normalizeVideoSourcePath(videoPath);
	if (!normalizedVideoPath) {
		return null;
	}

	const linkedWebcamPath = await resolveLinkedWebcamPath(normalizedVideoPath);
	return {
		videoPath: normalizedVideoPath,
		webcamPath: linkedWebcamPath,
	};
}
