import fs from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app } from "electron";
import { RECORDINGS_DIR } from "../appPaths";
import { AUTO_RECORDING_PREFIX, RECORDINGS_SETTINGS_FILE } from "./constants";
import {
	approvedLocalReadPaths,
	customRecordingsDir,
	recordingsDirLoaded,
	setCustomRecordingsDir,
	setRecordingsDirLoaded,
} from "./state";

const nodeRequire = createRequire(import.meta.url);

export function getScreen() {
	if (!app.isReady()) {
		throw new Error(
			"getScreen() called before app is ready. Ensure all screen access happens after app.whenReady().",
		);
	}
	return nodeRequire("electron").screen as typeof import("electron").screen;
}

export function normalizePath(filePath: string) {
	return path.resolve(filePath);
}

export function normalizeVideoSourcePath(videoPath?: string | null): string | null {
	if (typeof videoPath !== "string") {
		return null;
	}

	const trimmed = videoPath.trim();
	if (!trimmed) {
		return null;
	}

	if (/^file:\/\//i.test(trimmed)) {
		try {
			return fileURLToPath(trimmed);
		} catch {
			// Fall through and keep best-effort string path below.
		}
	}

	return trimmed;
}

export function stripJsonByteOrderMark(content: string) {
	return content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;
}

export function parseJsonWithByteOrderMark<T = unknown>(content: string): T {
	return JSON.parse(stripJsonByteOrderMark(content)) as T;
}

export function parseWindowId(sourceId?: string) {
	if (!sourceId) return null;
	const match = sourceId.match(/^window:(\d+)/);
	return match ? Number.parseInt(match[1], 10) : null;
}

export function getTelemetryPathForVideo(videoPath: string) {
	return `${videoPath}.cursor.json`;
}

export function isAutoRecordingPath(filePath: string) {
	return path.basename(filePath).startsWith(AUTO_RECORDING_PREFIX);
}

export async function moveFileWithOverwrite(sourcePath: string, destinationPath: string) {
	const destinationDir = path.dirname(destinationPath);
	await fs.mkdir(destinationDir, { recursive: true });

	// Stage the move inside the destination directory first so the existing
	// destination is only removed once the replacement is already on the same
	// volume; a mid-move failure restores it instead of deleting it outright.
	const stagedDestination = path.join(
		destinationDir,
		`.${path.basename(destinationPath)}.${Date.now()}.morec-tmp`,
	);

	try {
		try {
			await fs.rename(sourcePath, stagedDestination);
		} catch (error) {
			const nodeError = error as NodeJS.ErrnoException;
			if (nodeError.code !== "EXDEV") {
				throw error;
			}
			await fs.copyFile(sourcePath, stagedDestination);
			await fs.unlink(sourcePath);
		}

		await fs.rm(destinationPath, { force: true });
		await fs.rename(stagedDestination, destinationPath);
	} catch (error) {
		try {
			await fs.rename(stagedDestination, destinationPath);
		} catch {
			await fs.rm(stagedDestination, { force: true }).catch(() => undefined);
		}
		throw error;
	}
}

async function loadRecordingsDirectorySetting() {
	if (recordingsDirLoaded) {
		return;
	}

	setRecordingsDirLoaded(true);

	try {
		const content = await fs.readFile(RECORDINGS_SETTINGS_FILE, "utf-8");
		const parsed = parseJsonWithByteOrderMark<{ recordingsDir?: unknown }>(content);
		if (typeof parsed.recordingsDir === "string" && parsed.recordingsDir.trim()) {
			setCustomRecordingsDir(path.resolve(parsed.recordingsDir));
		}
	} catch {
		setCustomRecordingsDir(null);
	}
}

export async function getRecordingsDir() {
	await loadRecordingsDirectorySetting();
	const targetDir = customRecordingsDir ?? RECORDINGS_DIR;
	await fs.mkdir(targetDir, { recursive: true });
	return targetDir;
}

export function getMacPrivacySettingsUrl(pane: "screen" | "accessibility" | "microphone"): string {
	if (pane === "screen")
		return "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture";
	if (pane === "microphone")
		return "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone";
	return "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility";
}

export function approveUserPath(filePath: string | null | undefined): void {
	if (!filePath) return;
	try {
		approvedLocalReadPaths.add(path.resolve(filePath));
	} catch {
		// Ignore invalid paths; later reads will surface the underlying error.
	}
}

export {
	approveUserWritePath,
	isApprovedUserWritePath,
	resolveApprovedUserWritePath,
} from "./approvedPaths";
