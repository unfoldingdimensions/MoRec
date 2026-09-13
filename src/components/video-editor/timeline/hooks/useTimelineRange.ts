import type { Range } from "dnd-timeline";
import { useCallback, useEffect, useMemo, useState, type RefObject, type WheelEvent } from "react";
import { createInitialRange, normalizeWheelDeltaToPixels } from "../core/time";

interface UseTimelineRangeParams {
	totalMs: number;
	timelineContainerRef: RefObject<HTMLDivElement>;
	minVisibleRangeMs?: number;
}

export interface TimelineWheelPanDeltaInput {
	deltaX: number;
	deltaY: number;
	deltaMode: number;
	shiftKey?: boolean;
	ctrlKey?: boolean;
	metaKey?: boolean;
	canScrollVertically?: boolean;
}

export interface TimelineWheelZoomInput {
	previous: { start: number; end: number };
	deltaPx: number;
	pivotRatio: number;
	totalMs: number;
	minVisibleRangeMs: number;
}

// ~17% visible-span change per standard 100px wheel notch.
const ZOOM_WHEEL_SCALE = 1 / 600;

export function resolveTimelineWheelZoomRange({
	previous,
	deltaPx,
	pivotRatio,
	totalMs,
	minVisibleRangeMs,
}: TimelineWheelZoomInput): Range | null {
	if (!Number.isFinite(deltaPx) || deltaPx === 0 || totalMs <= 0) {
		return null;
	}

	const prevStart = Math.max(0, Math.min(previous.start, totalMs));
	const prevEnd = Math.min(previous.end, totalMs);
	const visibleSpan = Math.max(1, prevEnd - prevStart);
	const minSpan = Math.min(Math.max(minVisibleRangeMs, 1), totalMs);

	// Scroll up (negative delta) zooms in around the cursor; scroll down zooms out.
	const scale = Math.exp(deltaPx * ZOOM_WHEEL_SCALE);
	const nextSpan = Math.min(totalMs, Math.max(minSpan, visibleSpan * scale));
	if (nextSpan === visibleSpan) {
		return null;
	}

	const safePivotRatio = Number.isFinite(pivotRatio)
		? Math.min(1, Math.max(0, pivotRatio))
		: 0.5;
	const pivotMs = prevStart + safePivotRatio * visibleSpan;
	const maxStart = Math.max(0, totalMs - nextSpan);
	const nextStart = Math.max(0, Math.min(pivotMs - safePivotRatio * nextSpan, maxStart));
	return { start: nextStart, end: nextStart + nextSpan };
}

export function resolveTimelineWheelPanDeltaPx({
	deltaX,
	deltaY,
	deltaMode,
	shiftKey = false,
	ctrlKey = false,
	metaKey = false,
	canScrollVertically = true,
}: TimelineWheelPanDeltaInput) {
	if ((ctrlKey || metaKey) && !shiftKey) {
		return 0;
	}

	if (Math.abs(deltaX) > 0) {
		return normalizeWheelDeltaToPixels(deltaX, deltaMode);
	}

	if ((shiftKey || !canScrollVertically) && Math.abs(deltaY) > 0) {
		return normalizeWheelDeltaToPixels(deltaY, deltaMode);
	}

	return 0;
}

export function useTimelineRange({
	totalMs,
	timelineContainerRef,
	minVisibleRangeMs = 1_000,
}: UseTimelineRangeParams) {
	const [range, setRange] = useState<Range>(() => createInitialRange(totalMs));

	useEffect(() => {
		setRange(createInitialRange(totalMs));
	}, [totalMs]);

	const clampedRange = useMemo<Range>(() => {
		if (totalMs === 0) {
			return range;
		}
		return {
			start: Math.max(0, Math.min(range.start, totalMs)),
			end: Math.min(range.end, totalMs),
		};
	}, [range, totalMs]);

	const panTimelineRange = useCallback(
		(deltaMs: number) => {
			if (!Number.isFinite(deltaMs) || deltaMs === 0 || totalMs <= 0) {
				return;
			}

			setRange((previous) => {
				const visibleSpan = Math.max(1, previous.end - previous.start);
				const maxStart = Math.max(0, totalMs - visibleSpan);
				const nextStart = Math.max(0, Math.min(previous.start + deltaMs, maxStart));
				return { start: nextStart, end: nextStart + visibleSpan };
			});
		},
		[totalMs],
	);

	const zoomTimelineRange = useCallback(
		(deltaPx: number, pivotRatio: number) => {
			if (totalMs <= 0 || !Number.isFinite(deltaPx) || deltaPx === 0) {
				return;
			}
			setRange(
				(previous) =>
					resolveTimelineWheelZoomRange({
						previous,
						deltaPx,
						pivotRatio,
						totalMs,
						minVisibleRangeMs,
					}) ?? previous,
			);
		},
		[minVisibleRangeMs, totalMs],
	);

	// Ctrl+Scroll zoom needs a native non-passive listener: React attaches root
	// wheel listeners passively, so preventDefault there cannot stop Chromium's
	// page zoom. (Plain/Shift+Scroll panning stays on the React handler below.)
	useEffect(() => {
		const container = timelineContainerRef.current;
		if (!container) {
			return;
		}

		const handleWheel = (event: globalThis.WheelEvent) => {
			if (!(event.ctrlKey || event.metaKey) || event.shiftKey || totalMs <= 0) {
				return;
			}
			const rect = container.getBoundingClientRect();
			if (rect.width <= 0) {
				return;
			}
			event.preventDefault();
			zoomTimelineRange(
				normalizeWheelDeltaToPixels(event.deltaY, event.deltaMode),
				(event.clientX - rect.left) / rect.width,
			);
		};

		container.addEventListener("wheel", handleWheel, { passive: false });
		return () => container.removeEventListener("wheel", handleWheel);
	}, [timelineContainerRef, totalMs, zoomTimelineRange]);

	const handleTimelineWheel = useCallback(
		(event: WheelEvent<HTMLDivElement>) => {
			if (((event.ctrlKey || event.metaKey) && !event.shiftKey) || totalMs <= 0) {
				return;
			}

			const container = timelineContainerRef.current;
			const horizontalDeltaPx = resolveTimelineWheelPanDeltaPx({
				deltaX: event.deltaX,
				deltaY: event.deltaY,
				deltaMode: event.deltaMode,
				shiftKey: event.shiftKey,
				ctrlKey: event.ctrlKey,
				metaKey: event.metaKey,
				canScrollVertically: container
					? container.scrollHeight > container.clientHeight + 1
					: true,
			});

			if (horizontalDeltaPx === 0) {
				return;
			}

			const containerWidth = container?.clientWidth ?? 0;
			const visibleRangeMs = clampedRange.end - clampedRange.start;
			if (containerWidth <= 0 || visibleRangeMs <= 0) {
				return;
			}

			event.preventDefault();
			const deltaMs = (horizontalDeltaPx / containerWidth) * visibleRangeMs;
			panTimelineRange(deltaMs);
		},
		[clampedRange.end, clampedRange.start, panTimelineRange, timelineContainerRef, totalMs],
	);

	return {
		range,
		setRange,
		clampedRange,
		handleTimelineWheel,
	};
}
