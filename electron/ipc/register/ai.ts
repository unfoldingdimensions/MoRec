import { ipcMain } from "electron";
import {
	AI_CREDENTIALS_STORE_KEY,
	clearSecret,
	hasSecret,
	isSecretEncryptionAvailable,
	storeSecret,
} from "../ai/credentials";
import { summarizeTranscript } from "../ai/summarize";
import { isAllowedLocalReadPath } from "../project/manager";
import { analyzeCompanionAudioSilenceFromVideo } from "../recording/companionSilence";
import type { CaptionCuePayload } from "../types";
import { normalizeVideoSourcePath } from "../utils";

/**
 * AI metadata handlers: credential storage (safeStorage-encrypted, renderer
 * only ever sees a hasKey boolean) and summarize-transcript.
 */

export function registerAiHandlers() {
	ipcMain.handle("ai:has-api-key", () => {
		return { success: true, hasKey: hasSecret(AI_CREDENTIALS_STORE_KEY) };
	});

	ipcMain.handle("ai:set-api-key", (_event, apiKey: unknown) => {
		if (typeof apiKey !== "string" || apiKey.trim().length === 0) {
			return { success: false, error: "The API key must be a non-empty string." };
		}
		if (!isSecretEncryptionAvailable()) {
			return {
				success: false,
				error:
					"Secure credential storage is unavailable on this system, so the key cannot be saved.",
			};
		}
		const stored = storeSecret(AI_CREDENTIALS_STORE_KEY, apiKey.trim());
		return stored
			? { success: true }
			: {
					success: false,
					error:
						"Secure credential storage is unavailable on this system, so the key cannot be saved.",
				};
	});

	ipcMain.handle("ai:clear-api-key", () => {
		clearSecret(AI_CREDENTIALS_STORE_KEY);
		return { success: true };
	});

	ipcMain.handle(
		"summarize-transcript",
		async (
			_,
			options: {
				videoPath?: string | null;
				cues: CaptionCuePayload[];
				zoomRegions: Array<{ startMs: number; endMs: number; depth?: number }>;
				durationMs: number;
			},
		) => {
			try {
				const cues = Array.isArray(options?.cues) ? options.cues : [];
				const zoomRegions = Array.isArray(options?.zoomRegions) ? options.zoomRegions : [];
				const durationMs = Number.isFinite(options?.durationMs)
					? Math.max(0, Math.round(options.durationMs as number))
					: 0;

				// Chapters fall back to silence boundaries when the project has no
				// zoom regions; that analysis runs ffmpeg against the recording.
				// Same read-consent gate as analyze-companion-audio-silence: an
				// unapproved path silently skips the analysis.
				let silenceIntervals: Array<{ startMs: number; endMs: number }> | undefined;
				if (zoomRegions.length === 0) {
					try {
						const videoPath = normalizeVideoSourcePath(options?.videoPath);
						if (videoPath && isAllowedLocalReadPath(videoPath)) {
							const analysis = await analyzeCompanionAudioSilenceFromVideo({
								videoPath,
								totalDurationMs: durationMs,
							});
							silenceIntervals = analysis.intervals;
						}
					} catch (error) {
						// Silence analysis is optional for chapter derivation.
						console.warn("[ai-summary] Silence analysis unavailable:", error);
					}
				}

				const result = await summarizeTranscript({
					videoPath: options?.videoPath ?? null,
					cues,
					zoomRegions,
					durationMs,
					silenceIntervals,
				});
				return { success: true, ...result };
			} catch (error) {
				console.error("Failed to summarize transcript:", error);
				return {
					success: false,
					engine: "heuristic" as const,
					error: "Failed to generate a summary from the transcript.",
				};
			}
		},
	);
}
