import { useCallback, useMemo } from "react";
import { resolveMediaElementSource } from "@/lib/exporter/localMediaSource";
import type { TimelineAudioRegion } from "../../core/timelineTypes";
import { resolveAudioPlacement } from "../utils/timelineAudioPlacement";
import { timelineNotifications } from "../utils/timelineNotifications";

interface AudioFilePickerResult {
	success: boolean;
	path?: string;
}

interface TimelineAudioActionsDeps {
	openFilePicker: () => Promise<AudioFilePickerResult | null | undefined>;
	probeAudioDurationMs: (audioPath: string) => Promise<number>;
	reportError: (title: string, description: string) => void;
}

interface UseTimelineAudioActionsParams {
	timeline: {
		videoDuration: number;
		totalMs: number;
		currentTimeMs: number;
	};
	regions: {
		audio: TimelineAudioRegion[];
	};
	onAudioAdded?: (
		span: { start: number; end: number },
		audioPath: string,
		trackIndex?: number,
	) => void;
	deps?: Partial<TimelineAudioActionsDeps>;
}

async function defaultOpenFilePicker(): Promise<AudioFilePickerResult | null | undefined> {
	return window.electronAPI.openAudioFilePicker();
}

async function defaultProbeAudioDurationMs(audioPath: string): Promise<number> {
	const resolved = await resolveMediaElementSource(audioPath);
	return new Promise<number>((resolve) => {
		const audio = new Audio();
		let settled = false;
		const finish = (durationMs: number) => {
			if (settled) return;
			settled = true;
			clearTimeout(timeout);
			resolve(durationMs);
			cleanup();
		};
		const cleanup = () => {
			audio.removeAttribute("src");
			audio.load();
			resolved.revoke();
		};

		// A stalled decode (revoked blob URL, unsupported codec probe) never
		// fires either event; without a timeout the Add Audio action hangs
		// forever with no feedback and leaks the object URL.
		const timeout = setTimeout(() => finish(0), 10_000);

		audio.addEventListener("loadedmetadata", () => finish(Math.round(audio.duration * 1000)), {
			once: true,
		});
		audio.addEventListener("error", () => finish(0), { once: true });
		audio.src = resolved.src;
	});
}

function buildTimelineAudioActionsDeps(
	overrides?: Partial<TimelineAudioActionsDeps>,
): TimelineAudioActionsDeps {
	return {
		openFilePicker: overrides?.openFilePicker ?? defaultOpenFilePicker,
		probeAudioDurationMs: overrides?.probeAudioDurationMs ?? defaultProbeAudioDurationMs,
		reportError: overrides?.reportError ?? timelineNotifications.error,
	};
}

export function useTimelineAudioActions({
	timeline,
	regions,
	onAudioAdded,
	deps: depsOverrides,
}: UseTimelineAudioActionsParams) {
	const { videoDuration, totalMs, currentTimeMs } = timeline;
	const { audio: audioRegions } = regions;
	const deps = useMemo(() => buildTimelineAudioActionsDeps(depsOverrides), [depsOverrides]);

	const handleAddAudio = useCallback(
		async (preferredTrackIndex?: number) => {
			if (!videoDuration || videoDuration === 0 || totalMs === 0 || !onAudioAdded) {
				return;
			}

			const result = await deps.openFilePicker();
			if (!result?.success || !result.path) {
				return;
			}

			const audioPath = result.path;
			const audioDurationMs = await deps.probeAudioDurationMs(audioPath);
			if (audioDurationMs <= 0) {
				deps.reportError(
					"Could not read audio file",
					"The selected file may be corrupted or in an unsupported format.",
				);
				return;
			}

			const startPos = Math.max(0, Math.min(currentTimeMs, totalMs));
			if (totalMs - startPos <= 0) {
				deps.reportError(
					"Cannot place audio here",
					"There is no remaining space at the current playhead position.",
				);
				return;
			}

			const placement = resolveAudioPlacement({
				audioRegions,
				startPos,
				totalMs,
				audioDurationMs,
				preferredTrackIndex,
			});
			if (!placement) {
				deps.reportError(
					"Cannot place audio here",
					"Audio region already exists at this location or not enough space available.",
				);
				return;
			}

			onAudioAdded(
				{ start: startPos, end: startPos + placement.durationMs },
				audioPath,
				placement.trackIndex,
			);
		},
		[videoDuration, totalMs, onAudioAdded, deps, currentTimeMs, audioRegions],
	);

	return { handleAddAudio };
}
