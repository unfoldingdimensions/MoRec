import { retimeCue } from "./captionOps";
import type {
	AnnotationRegion,
	AudioRegion,
	CaptionCue,
	ClipRegion,
	SpeedRegion,
	ZoomRegion,
} from "./types";

export type ClipSpeedChangeBlockReason = "clip-overlap" | "zoom-overlap";

export interface ClipSpeedChangePlan {
	clipRegions: ClipRegion[];
	zoomRegions: ZoomRegion[];
	audioRegions: AudioRegion[];
	annotationRegions: AnnotationRegion[];
	speedRegions: SpeedRegion[];
	captionCues: CaptionCue[];
}

export interface BlockedClipSpeedChange {
	blockedReason: ClipSpeedChangeBlockReason;
}

export function formatClipSpeedLabel(speed: number): string | null {
	if (!Number.isFinite(speed) || speed <= 0 || speed === 1) {
		return null;
	}

	return `${Number.isInteger(speed) ? speed.toFixed(0) : speed.toString()}x`;
}

function spansOverlap(
	left: { startMs: number; endMs: number },
	right: { startMs: number; endMs: number },
): boolean {
	return left.startMs < right.endMs && left.endMs > right.startMs;
}

interface ClipSpan {
	startMs: number;
	endMs: number;
}

interface CaptionRetimeMapping {
	id: string;
	startMs: number;
	endMs: number;
}

function mapClipLocalMs(value: number, clip: ClipSpan, scaleFactor: number): number {
	return Math.round(clip.startMs + (value - clip.startMs) * scaleFactor);
}

/**
 * Remap regions whose start falls inside the clip being re-timed. Ends are
 * clamped to the clip's new end so a region that straddled the old clip
 * boundary cannot hang over the content that follows the clip. (Zoom regions
 * keep their own unclamped remap below — that behavior predates this helper.)
 */
function remapRegionsStartingInsideClip<T extends { startMs: number; endMs: number }>(
	regions: T[],
	clip: ClipSpan,
	scaleFactor: number,
	newEndMs: number,
): T[] {
	return regions.map((region) => {
		if (region.startMs < clip.startMs || region.startMs >= clip.endMs) {
			return region;
		}

		const startMs = mapClipLocalMs(region.startMs, clip, scaleFactor);
		return {
			...region,
			startMs,
			endMs: Math.min(
				newEndMs,
				Math.max(startMs + 1, mapClipLocalMs(region.endMs, clip, scaleFactor)),
			),
		};
	});
}

/**
 * Retime cues whose start falls inside the clip. Goes through retimeCue so
 * per-word timings are rescaled along with the cue span, not just the edges.
 */
function remapCaptionsStartingInsideClip(
	cues: CaptionCue[],
	clip: ClipSpan,
	scaleFactor: number,
	newEndMs: number,
): CaptionCue[] {
	const remappings: CaptionRetimeMapping[] = [];
	for (const cue of cues) {
		if (cue.startMs < clip.startMs || cue.startMs >= clip.endMs) {
			continue;
		}

		const startMs = mapClipLocalMs(cue.startMs, clip, scaleFactor);
		const endMs = Math.min(newEndMs, mapClipLocalMs(cue.endMs, clip, scaleFactor));
		if (endMs > startMs) {
			remappings.push({ id: cue.id, startMs, endMs });
		}
	}

	return remappings.reduce((next, mapping) => retimeCue(next, mapping.id, mapping), cues);
}

export function planClipSpeedChange(params: {
	clipRegions: ClipRegion[];
	zoomRegions: ZoomRegion[];
	audioRegions: AudioRegion[];
	annotationRegions: AnnotationRegion[];
	speedRegions: SpeedRegion[];
	captions: CaptionCue[];
	selectedClipId: string;
	speed: number;
}): ClipSpeedChangePlan | BlockedClipSpeedChange | null {
	const {
		clipRegions,
		zoomRegions,
		audioRegions,
		annotationRegions,
		speedRegions,
		captions,
		selectedClipId,
		speed,
	} = params;
	if (!selectedClipId || !Number.isFinite(speed) || speed <= 0) {
		return null;
	}

	const clip = clipRegions.find((candidate) => candidate.id === selectedClipId);
	if (!clip) {
		return null;
	}

	const oldSpeed = Number.isFinite(clip.speed) && clip.speed > 0 ? clip.speed : 1;
	const sourceDurationMs = Math.max(0, clip.endMs - clip.startMs) * oldSpeed;
	const newEndMs = Math.round(clip.startMs + sourceDurationMs / speed);
	const nextClip = clipRegions
		.filter((candidate) => candidate.id !== selectedClipId && candidate.startMs >= clip.endMs)
		.sort((left, right) => left.startMs - right.startMs)[0];

	if (nextClip && newEndMs > nextClip.startMs) {
		return { blockedReason: "clip-overlap" };
	}

	const scaleFactor = oldSpeed / speed;
	const nextZoomRegions = zoomRegions.map((zoom) => {
		if (zoom.startMs < clip.startMs || zoom.startMs >= clip.endMs) {
			return zoom;
		}

		return {
			...zoom,
			startMs: Math.round(clip.startMs + (zoom.startMs - clip.startMs) * scaleFactor),
			endMs: Math.round(clip.startMs + (zoom.endMs - clip.startMs) * scaleFactor),
		};
	});

	const changedZoomIds = new Set(
		nextZoomRegions
			.filter((zoom, index) => {
				const previous = zoomRegions[index];
				return previous.startMs !== zoom.startMs || previous.endMs !== zoom.endMs;
			})
			.map((zoom) => zoom.id),
	);

	const hasZoomOverlap = nextZoomRegions.some((zoom, index) =>
		nextZoomRegions.some(
			(other, otherIndex) =>
				index !== otherIndex &&
				(changedZoomIds.has(zoom.id) || changedZoomIds.has(other.id)) &&
				spansOverlap(zoom, other),
		),
	);

	if (hasZoomOverlap) {
		return { blockedReason: "zoom-overlap" };
	}

	return {
		clipRegions: clipRegions.map((candidate) =>
			candidate.id === selectedClipId ? { ...candidate, speed, endMs: newEndMs } : candidate,
		),
		zoomRegions: nextZoomRegions,
		audioRegions: remapRegionsStartingInsideClip(audioRegions, clip, scaleFactor, newEndMs),
		annotationRegions: remapRegionsStartingInsideClip(
			annotationRegions,
			clip,
			scaleFactor,
			newEndMs,
		),
		speedRegions: remapRegionsStartingInsideClip(speedRegions, clip, scaleFactor, newEndMs),
		captionCues: remapCaptionsStartingInsideClip(captions, clip, scaleFactor, newEndMs),
	};
}
