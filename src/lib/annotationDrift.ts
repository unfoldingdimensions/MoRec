/**
 * Two-position drift for mask annotations ("scroll-tracking" v2): a region
 * may carry an optional `endPosition` and glides linearly from `position` to
 * it across its own [startMs, endMs] span. Shared by the editor preview and
 * the export renderers so both move identically.
 */

import type { AnnotationPosition, AnnotationRegion } from "@/components/video-editor/types";

export interface DriftCapableRegion {
	position: AnnotationPosition;
	endPosition?: AnnotationPosition;
	startMs: number;
	endMs: number;
}

const DEFAULT_POSITION: AnnotationPosition = { x: 50, y: 50 };

/** True when the region actually moves (two distinct positions configured). */
export function hasAnnotationDrift(region: DriftCapableRegion): boolean {
	return Boolean(
		region.endPosition &&
			(region.endPosition.x !== region.position.x || region.endPosition.y !== region.position.y),
	);
}

/**
 * Position of the region at `timeMs`, in frame percentages. Progress is
 * clamped to [0, 1] so before/after the span the region rests at its start or
 * end corner; a missing or zero-length span yields the static base position.
 */
export function resolveAnnotationPosition(
	region: DriftCapableRegion,
	timeMs: number,
): AnnotationPosition {
	const base = region.position ?? DEFAULT_POSITION;
	if (!region.endPosition || !Number.isFinite(timeMs)) {
		return base;
	}

	const spanMs = region.endMs - region.startMs;
	if (!Number.isFinite(spanMs) || spanMs <= 0) {
		return base;
	}

	const progress = Math.min(1, Math.max(0, (timeMs - region.startMs) / spanMs));
	return {
		x: base.x + (region.endPosition.x - base.x) * progress,
		y: base.y + (region.endPosition.y - base.y) * progress,
	};
}

/** Type-narrowing helper: drift is only surfaced for mask-style annotations. */
export function isMaskAnnotation(region: AnnotationRegion): boolean {
	return region.type === "blur";
}
