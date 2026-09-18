import fs from "node:fs/promises";
import {
	CURSOR_SAMPLE_INTERVAL_MS,
	CURSOR_TELEMETRY_VERSION,
	MAX_CURSOR_SAMPLES,
} from "../constants";
import {
	activeCursorSamples,
	currentCursorVisualType,
	cursorCaptureAccumulatedPausedMs,
	cursorCaptureInterval,
	cursorCapturePauseStartedAtMs,
	cursorCaptureStartTimeMs,
	isCursorCaptureActive,
	linuxCursorScreenPoint,
	pendingCursorSamples,
	selectedSource,
	selectedWindowBounds,
	setActiveCursorSamples,
	setCursorCaptureAccumulatedPausedMs,
	setCursorCaptureInterval,
	setCursorCapturePauseStartedAtMs,
	setPendingCursorSamples,
} from "../state";
import type {
	CursorInteractionType,
	CursorTelemetryPoint,
	CursorVisualType,
	WindowBounds,
} from "../types";
import { getScreen, getTelemetryPathForVideo } from "../utils";

export function clamp(value: number, min: number, max: number) {
	return Math.min(max, Math.max(min, value));
}

export function normalizeCursorTelemetrySamples(rawSamples: unknown): CursorTelemetryPoint[] {
	const samples = Array.isArray(rawSamples)
		? rawSamples
		: Array.isArray((rawSamples as { samples?: unknown[] } | null | undefined)?.samples)
			? ((rawSamples as { samples: unknown[] }).samples ?? [])
			: [];
	const boundedSamples = samples.slice(0, MAX_CURSOR_SAMPLES);

	return boundedSamples
		.filter((sample: unknown) => Boolean(sample && typeof sample === "object"))
		.map((sample: unknown) => {
			const point = sample as Partial<CursorTelemetryPoint>;
			return {
				timeMs:
					typeof point.timeMs === "number" && Number.isFinite(point.timeMs)
						? Math.max(0, point.timeMs)
						: 0,
				cx:
					typeof point.cx === "number" && Number.isFinite(point.cx)
						? clamp(point.cx, 0, 1)
						: 0.5,
				cy:
					typeof point.cy === "number" && Number.isFinite(point.cy)
						? clamp(point.cy, 0, 1)
						: 0.5,
				interactionType:
					point.interactionType === "click" ||
					point.interactionType === "double-click" ||
					point.interactionType === "right-click" ||
					point.interactionType === "middle-click" ||
					point.interactionType === "move" ||
					point.interactionType === "mouseup" ||
					point.interactionType === "key"
						? point.interactionType
						: undefined,
				cursorType:
					point.cursorType === "arrow" ||
					point.cursorType === "text" ||
					point.cursorType === "pointer" ||
					point.cursorType === "crosshair" ||
					point.cursorType === "open-hand" ||
					point.cursorType === "closed-hand" ||
					point.cursorType === "resize-ew" ||
					point.cursorType === "resize-ns" ||
					point.cursorType === "not-allowed"
						? point.cursorType
						: undefined,
			};
		})
		.sort((a, b) => a.timeMs - b.timeMs);
}

export async function writeCursorTelemetry(videoPath: string, samples: unknown) {
	const telemetryPath = getTelemetryPathForVideo(videoPath);
	const normalizedSamples = normalizeCursorTelemetrySamples(samples);

	if (normalizedSamples.length === 0) {
		await fs.rm(telemetryPath, { force: true });
		return normalizedSamples;
	}

	await fs.writeFile(
		telemetryPath,
		JSON.stringify({ version: CURSOR_TELEMETRY_VERSION, samples: normalizedSamples }, null, 2),
		"utf-8",
	);

	return normalizedSamples;
}

export function stopCursorCapture() {
	if (cursorCaptureInterval) {
		clearTimeout(cursorCaptureInterval);
		setCursorCaptureInterval(null);
	}
}

export function resetCursorCaptureClock() {
	setCursorCaptureAccumulatedPausedMs(0);
	setCursorCapturePauseStartedAtMs(null);
}

export function isCursorCapturePaused() {
	return cursorCapturePauseStartedAtMs !== null;
}

export function pauseCursorCapture(pausedAtMs: number) {
	if (cursorCapturePauseStartedAtMs !== null) {
		return;
	}

	setCursorCapturePauseStartedAtMs(pausedAtMs);
}

export function pauseCursorCaptureAtBoundary(pausedAtMs: number) {
	if (cursorCapturePauseStartedAtMs !== null) {
		return;
	}

	const pausedElapsedMs = getCursorCaptureElapsedMs(pausedAtMs);
	setActiveCursorSamples(
		activeCursorSamples.filter((sample) => sample.timeMs <= pausedElapsedMs),
	);
	setCursorCapturePauseStartedAtMs(pausedAtMs);
}

export function resumeCursorCapture(resumedAtMs: number) {
	if (cursorCapturePauseStartedAtMs === null) {
		return;
	}

	const pauseDurationMs = Math.max(0, resumedAtMs - cursorCapturePauseStartedAtMs);
	setCursorCaptureAccumulatedPausedMs(cursorCaptureAccumulatedPausedMs + pauseDurationMs);
	setCursorCapturePauseStartedAtMs(null);
}

export function getCursorCaptureElapsedMs(nowMs = Date.now()) {
	if (!Number.isFinite(cursorCaptureStartTimeMs) || cursorCaptureStartTimeMs <= 0) {
		return 0;
	}

	const safeNowMs = Math.max(cursorCaptureStartTimeMs, nowMs);
	const activePauseDurationMs =
		cursorCapturePauseStartedAtMs === null
			? 0
			: Math.max(0, safeNowMs - cursorCapturePauseStartedAtMs);

	return Math.max(
		0,
		safeNowMs -
			cursorCaptureStartTimeMs -
			Math.max(0, cursorCaptureAccumulatedPausedMs) -
			activePauseDurationMs,
	);
}

export type DisplayScaleFactorLike = {
	bounds: { x: number; y: number; width: number; height: number };
	scaleFactor?: number;
};

// Locates the display whose physical-pixel rect (DIP bounds × scale factor)
// contains the point, falling back to the display whose rect is nearest so a
// rounding sliver at a shared edge cannot produce "no display".
export function findDisplayForPhysicalPoint(
	displays: DisplayScaleFactorLike[],
	px: number,
	py: number,
): DisplayScaleFactorLike | null {
	let nearest: DisplayScaleFactorLike | null = null;
	let nearestDistance = Number.POSITIVE_INFINITY;

	for (const display of displays) {
		const sf = display.scaleFactor || 1;
		const x = display.bounds.x * sf;
		const y = display.bounds.y * sf;
		const width = display.bounds.width * sf;
		const height = display.bounds.height * sf;

		if (px >= x && px < x + width && py >= y && py < y + height) {
			return display;
		}

		const dx = Math.max(x - px, 0, px - (x + width));
		const dy = Math.max(y - py, 0, py - (y + height));
		const distance = Math.hypot(dx, dy);
		if (distance < nearestDistance) {
			nearestDistance = distance;
			nearest = display;
		}
	}

	return nearest;
}

// Window bounds arriving from the Windows PowerShell bridge are physical
// pixels (per-monitor-v2 aware GetWindowRect), while the Electron cursor
// point is in DIPs. Map the window into the owning display's DIP space
// before normalizing; without a match, fall back to unscaled (sf = 1).
export function normalizeCursorPointToWindowRegion(
	cursor: { x: number; y: number },
	windowBounds: WindowBounds,
	displays: DisplayScaleFactorLike[],
): { cx: number; cy: number } {
	const display =
		findDisplayForPhysicalPoint(displays, windowBounds.x, windowBounds.y) ??
		findDisplayForPhysicalPoint(
			displays,
			windowBounds.x + windowBounds.width / 2,
			windowBounds.y + windowBounds.height / 2,
		);
	const sf = display?.scaleFactor || 1;
	const x = windowBounds.x / sf;
	const y = windowBounds.y / sf;
	const width = Math.max(1, windowBounds.width / sf);
	const height = Math.max(1, windowBounds.height / sf);

	return {
		cx: clamp((cursor.x - x) / width, 0, 1),
		cy: clamp((cursor.y - y) / height, 0, 1),
	};
}

// DIP size of the region cursor points are normalized against (the captured
// window when one is selected, otherwise the target display). Consumers that
// need a physical intuition for normalized deltas — e.g. the double-click
// distance check — use this instead of hardcoding fractions of the region,
// whose meaning used to change with every capture target.
export function getCursorRegionSizeDip(): { width: number; height: number } | null {
	const windowBounds = selectedSource?.id?.startsWith("window:") ? selectedWindowBounds : null;
	if (windowBounds) {
		const displays = getScreen().getAllDisplays();
		const display =
			findDisplayForPhysicalPoint(displays, windowBounds.x, windowBounds.y) ??
			findDisplayForPhysicalPoint(
				displays,
				windowBounds.x + windowBounds.width / 2,
				windowBounds.y + windowBounds.height / 2,
			);
		const sf = display?.scaleFactor || 1;
		return {
			width: Math.max(1, windowBounds.width / sf),
			height: Math.max(1, windowBounds.height / sf),
		};
	}

	const sourceDisplayId = Number(selectedSource?.display_id);
	const sourceDisplay = Number.isFinite(sourceDisplayId)
		? (getScreen()
				.getAllDisplays()
				.find((display) => display.id === sourceDisplayId) ?? null)
		: null;
	const display = sourceDisplay ?? getScreen().getDisplayNearestPoint(getScreen().getCursorScreenPoint());
	return {
		width: Math.max(1, display.bounds.width),
		height: Math.max(1, display.bounds.height),
	};
}

export function getNormalizedCursorPoint() {
	const fallbackCursor = getScreen().getCursorScreenPoint();
	const linuxCursorCache = process.platform === "linux" ? linuxCursorScreenPoint : null;
	const isLinuxCacheFresh = !!linuxCursorCache && Date.now() - linuxCursorCache.updatedAt <= 1000;

	const primarySf =
		process.platform !== "darwin" ? getScreen().getPrimaryDisplay().scaleFactor || 1 : 1;

	const cursor = isLinuxCacheFresh
		? { x: linuxCursorCache.x / primarySf, y: linuxCursorCache.y / primarySf }
		: fallbackCursor;

	const windowBounds = selectedSource?.id?.startsWith("window:") ? selectedWindowBounds : null;
	if (windowBounds) {
		return normalizeCursorPointToWindowRegion(cursor, windowBounds, getScreen().getAllDisplays());
	}

	const sourceDisplayId = Number(selectedSource?.display_id);
	const sourceDisplay = Number.isFinite(sourceDisplayId)
		? (getScreen()
				.getAllDisplays()
				.find((display) => display.id === sourceDisplayId) ?? null)
		: null;
	const display = sourceDisplay ?? getScreen().getDisplayNearestPoint(cursor);
	const bounds = display.bounds;
	const width = Math.max(1, bounds.width);
	const height = Math.max(1, bounds.height);

	const cx = clamp((cursor.x - bounds.x) / width, 0, 1);
	const cy = clamp((cursor.y - bounds.y) / height, 0, 1);
	return { cx, cy };
}

export function getHookCursorScreenPoint(
	event:
		| {
				x?: number;
				y?: number;
				data?: { x?: number; y?: number; screenX?: number; screenY?: number };
				screenX?: number;
				screenY?: number;
		  }
		| null
		| undefined,
): { x: number; y: number } | null {
	const rawX = event?.x ?? event?.data?.x ?? event?.screenX ?? event?.data?.screenX;
	const rawY = event?.y ?? event?.data?.y ?? event?.screenY ?? event?.data?.screenY;

	if (
		typeof rawX !== "number" ||
		!Number.isFinite(rawX) ||
		typeof rawY !== "number" ||
		!Number.isFinite(rawY)
	) {
		return null;
	}

	return { x: rawX, y: rawY };
}

export function pushCursorSample(
	cx: number,
	cy: number,
	timeMs: number,
	interactionType: CursorInteractionType = "move",
	cursorType?: CursorVisualType,
) {
	activeCursorSamples.push({
		timeMs: Math.max(0, timeMs),
		cx,
		cy,
		interactionType,
		cursorType: cursorType ?? currentCursorVisualType,
	} as CursorTelemetryPoint);

	if (activeCursorSamples.length > MAX_CURSOR_SAMPLES) {
		activeCursorSamples.shift();
	}
}

export function sampleCursorPoint() {
	const point = getNormalizedCursorPoint();
	pushCursorSample(point.cx, point.cy, getCursorCaptureElapsedMs(), "move");
}

export function sampleCursorStateChange(cursorType: CursorVisualType) {
	if (!isCursorCaptureActive || isCursorCapturePaused()) {
		return;
	}
	const point = getNormalizedCursorPoint();
	pushCursorSample(point.cx, point.cy, getCursorCaptureElapsedMs(), "move", cursorType);
}

export async function persistPendingCursorTelemetry(videoPath: string) {
	const telemetryPath = getTelemetryPathForVideo(videoPath);
	if (pendingCursorSamples.length > 0) {
		await fs.writeFile(
			telemetryPath,
			JSON.stringify(
				{ version: CURSOR_TELEMETRY_VERSION, samples: pendingCursorSamples },
				null,
				2,
			),
			"utf-8",
		);
	}
	setPendingCursorSamples([]);
}

export function snapshotCursorTelemetryForPersistence() {
	if (activeCursorSamples.length === 0) {
		return;
	}

	if (pendingCursorSamples.length === 0) {
		setPendingCursorSamples([...activeCursorSamples]);
		return;
	}

	const lastPendingTimeMs = pendingCursorSamples[pendingCursorSamples.length - 1]?.timeMs ?? -1;
	setPendingCursorSamples([
		...pendingCursorSamples,
		...activeCursorSamples.filter((sample) => sample.timeMs > lastPendingTimeMs),
	]);
}

export function startCursorSampling() {
	stopCursorCapture();

	// Use recursive setTimeout with drift compensation instead of setInterval.
	// Under CPU load setInterval bunches or skips callbacks, creating large gaps
	// in telemetry data.  This approach measures wall-clock drift each tick and
	// adjusts the next delay so samples stay close to the target interval.
	let nextExpectedMs = Date.now() + CURSOR_SAMPLE_INTERVAL_MS;

	const tick = () => {
		if (isCursorCaptureActive && !isCursorCapturePaused()) {
			sampleCursorPoint();
		}

		const now = Date.now();
		const drift = now - nextExpectedMs;
		nextExpectedMs += CURSOR_SAMPLE_INTERVAL_MS;

		// If we fell behind by more than one full interval, reset the baseline
		// so we don't try to "catch up" with a burst of rapid samples.
		if (drift > CURSOR_SAMPLE_INTERVAL_MS) {
			nextExpectedMs = now + CURSOR_SAMPLE_INTERVAL_MS;
		}

		const delay = Math.max(1, nextExpectedMs - now);
		setCursorCaptureInterval(setTimeout(tick, delay));
	};

	setCursorCaptureInterval(setTimeout(tick, CURSOR_SAMPLE_INTERVAL_MS));
}

export { CURSOR_SAMPLE_INTERVAL_MS } from "../constants";
// Re-export for consumers that use it from this module
export { getTelemetryPathForVideo } from "../utils";
