import type { ExportPipelineModel, ExportSettings } from "./types";

/**
 * Renderer-side bookkeeping for resumable Lightning (native static-layout)
 * exports. The main process owns the session dir + manifest; this module only
 * derives the settings hash and decides when the resume banner applies.
 */

const PENDING_RESUMABLE_EXPORT_KEY = "morec.export.resumableSession";

export interface PendingResumableExport {
	exportId: string;
	settingsHash: string;
	videoPath: string;
	savedAt: number;
}

export interface ExportSessionStatus {
	found: boolean;
	segmentCount?: number;
	doneCount?: number;
	settingsHash?: string;
	updatedAt?: string;
}

export interface ResumableExportBanner {
	exportId: string;
	doneCount: number;
	segmentCount: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

/**
 * Stable, renderer-computed fingerprint of the export inputs that determine
 * rendered segment content. The main process stores this hash verbatim in the
 * session manifest; a resume is only offered when the hashes match, so a
 * settings change never splices segments from an incompatible run.
 */
export function computeExportSettingsHash({
	videoPath,
	settings,
}: {
	videoPath: string;
	settings: ExportSettings;
}): string {
	const hashInput = {
		videoPath,
		backendPreference: settings.backendPreference ?? null,
		encodingMode: settings.encodingMode ?? null,
		format: settings.format,
		gifFrameRate: settings.gifConfig?.frameRate ?? null,
		gifLoop: settings.gifConfig?.loop ?? null,
		gifSizePreset: settings.gifConfig?.sizePreset ?? null,
		mp4FrameRate: settings.mp4FrameRate ?? null,
		pipelineModel: settings.pipelineModel ?? null,
		quality: settings.quality ?? null,
		targetSizeMb: settings.targetSizeMb ?? null,
	};
	const serialized = JSON.stringify(hashInput);

	// FNV-1a 32-bit: stable across runs, no crypto dependency, and collision
	// resistance is enough to distinguish user-visible settings changes.
	let hash = 0x811c9dc5;
	for (let index = 0; index < serialized.length; index++) {
		hash ^= serialized.charCodeAt(index);
		hash = Math.imul(hash, 0x01000193);
	}

	return (hash >>> 0).toString(16).padStart(8, "0");
}

function parsePendingResumableExport(raw: unknown): PendingResumableExport | null {
	if (!isRecord(raw)) {
		return null;
	}
	if (
		typeof raw.exportId !== "string" ||
		raw.exportId.length === 0 ||
		typeof raw.settingsHash !== "string" ||
		raw.settingsHash.length === 0 ||
		typeof raw.videoPath !== "string" ||
		raw.videoPath.length === 0 ||
		typeof raw.savedAt !== "number" ||
		!Number.isFinite(raw.savedAt)
	) {
		return null;
	}

	return {
		exportId: raw.exportId,
		settingsHash: raw.settingsHash,
		videoPath: raw.videoPath,
		savedAt: raw.savedAt,
	};
}

export function loadPendingResumableExport(): PendingResumableExport | null {
	try {
		const stored = globalThis.localStorage?.getItem(PENDING_RESUMABLE_EXPORT_KEY);
		if (!stored) {
			return null;
		}
		return parsePendingResumableExport(JSON.parse(stored));
	} catch {
		return null;
	}
}

export function savePendingResumableExport(entry: PendingResumableExport): void {
	try {
		globalThis.localStorage?.setItem(PENDING_RESUMABLE_EXPORT_KEY, JSON.stringify(entry));
	} catch {
		// Resume bookkeeping must never break the export itself.
	}
}

export function clearPendingResumableExport(): void {
	try {
		globalThis.localStorage?.removeItem(PENDING_RESUMABLE_EXPORT_KEY);
	} catch {
		// Ignore storage failures.
	}
}

/**
 * The export session only counts as resumable when the previous run used the
 * same video + rendering settings (hash match), the current route is the
 * Lightning (modern) native one, and the main process still has the session
 * dir on disk. Any mismatch returns null — the legacy/WebCodecs route is
 * explicitly non-resumable.
 */
export function resolveResumableExportBanner({
	pending,
	videoPath,
	settings,
	exportPipelineModel,
	sessionStatus,
}: {
	pending: PendingResumableExport | null;
	videoPath: string;
	settings: ExportSettings;
	exportPipelineModel: ExportPipelineModel;
	sessionStatus: ExportSessionStatus | null;
}): ResumableExportBanner | null {
	if (!pending) {
		return null;
	}
	if (exportPipelineModel !== "modern" || settings.format !== "mp4") {
		return null;
	}
	if (pending.videoPath !== videoPath) {
		return null;
	}
	if (pending.settingsHash !== computeExportSettingsHash({ videoPath, settings })) {
		return null;
	}
	if (!sessionStatus?.found) {
		return null;
	}
	if (
		typeof sessionStatus.segmentCount !== "number" ||
		typeof sessionStatus.doneCount !== "number" ||
		sessionStatus.segmentCount <= 0 ||
		sessionStatus.doneCount <= 0 ||
		sessionStatus.doneCount >= sessionStatus.segmentCount
	) {
		return null;
	}

	return {
		exportId: pending.exportId,
		doneCount: sessionStatus.doneCount,
		segmentCount: sessionStatus.segmentCount,
	};
}
