/**
 * Renderer-side decision logic for the post-recording audio diagnostic.
 * The main process only measures; this module decides whether a warning is
 * warranted and wraps the IPC call.
 */

/** Companion audio whose peak stays below this is effectively digital silence. */
export const SILENT_AUDIO_MAX_VOLUME_DB = -50;

export interface CompanionAudioLevelSnapshot {
	path: string;
	kind: "system" | "mic";
	maxVolumeDb: number | null;
	meanVolumeDb: number | null;
}

/**
 * Warn only when the user asked for system audio, a system companion track
 * was actually recorded, and every measured system track peaked below the
 * noise floor (an inaudible recording — usually a capture toggle/driver
 * problem). Mic-only recordings never warn here.
 */
export function shouldWarnSilentSystemAudio(options: {
	levels: CompanionAudioLevelSnapshot[];
	systemAudioEnabled: boolean;
}): boolean {
	if (!options.systemAudioEnabled) {
		return false;
	}
	const systemLevels = options.levels.filter((level) => level.kind === "system");
	if (systemLevels.length === 0) {
		return false;
	}
	return systemLevels.every(
		(level) =>
			level.maxVolumeDb !== null && level.maxVolumeDb < SILENT_AUDIO_MAX_VOLUME_DB,
	);
}

export async function detectSilentSystemAudio(
	videoPath: string,
	systemAudioEnabled: boolean,
): Promise<boolean> {
	if (!systemAudioEnabled || !window.electronAPI?.analyzeCompanionAudioLevels) {
		return false;
	}
	try {
		const result = await window.electronAPI.analyzeCompanionAudioLevels(videoPath);
		if (!result.success) {
			return false;
		}
		return shouldWarnSilentSystemAudio({
			levels: result.levels ?? [],
			systemAudioEnabled,
		});
	} catch {
		// The diagnostic is best-effort; it must never break finalization.
		return false;
	}
}
