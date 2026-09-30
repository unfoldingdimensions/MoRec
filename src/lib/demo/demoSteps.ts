import {
	buildClickClusters,
	detectInteractionCandidates,
	normalizeCursorTelemetry,
} from "@/components/video-editor/timeline/zoomSuggestionUtils";
import { mapCursorToCanvasNormalized } from "@/lib/extensions/cursorCoordinates";
import type { CursorTelemetryPoint } from "@/components/video-editor/types";

/**
 * Interactive-demo step derivation (pure): explicit cursor clicks become the
 * ordered steps of a click-through demo, one screenshot per step, with the
 * hotspot that advances to the next step mapped through the exact
 * `mapCursorToCanvasNormalized` transform the video export uses — so hotspot
 * geometry always matches what the exported video shows.
 *
 * All times are source-time milliseconds; all coordinates are normalized
 * (0..1). Step *i*'s `advance` targets step *i+1*; the last step has no
 * advance (its page offers Restart instead), so the emitted graph is a linear
 * chain with no unreachable step and no duplicates.
 */

/** Default upper bound on steps per demo (the configurable screenshot cap). */
export const DEFAULT_DEMO_STEP_CAP = 50;

/**
 * Clicks within this window merge into one step, so a double-click or a
 * rapid same-spot pair produces a single screenshot instead of two.
 */
export const DEMO_STEP_MERGE_GAP_MS = 600;

export interface DemoStep {
	/** 0-based position in the graph; order matches click order. */
	index: number;
	/** Source time of the step's screenshot (the cluster's first click). */
	timeMs: number;
	/**
	 * Canvas-normalized hotspot that advances to the next step. Null on the
	 * final step.
	 */
	advance: { cx: number; cy: number } | null;
}

export type DemoStepGraphStatus = "ok" | "no-telemetry" | "no-interactions";

export interface DemoStepGraph {
	status: DemoStepGraphStatus;
	steps: DemoStep[];
	/** True when more clicks existed than the cap allowed. */
	truncated: boolean;
}

export interface DeriveDemoStepGraphParams {
	cursorTelemetry: CursorTelemetryPoint[];
	/** Total source duration in milliseconds. */
	totalMs: number;
	/** Maximum number of steps (the configurable screenshot cap). */
	maxSteps?: number;
	/**
	 * Content rect of the composed canvas (the video area inside padding or a
	 * frame), passed straight to `mapCursorToCanvasNormalized`. Null keeps the
	 * identity clamp — hotspot space equals the raw captured content.
	 */
	contentRect?: { x: number; y: number; width: number; height: number } | null;
	canvasWidth?: number;
	canvasHeight?: number;
	mergeGapMs?: number;
}

const emptyGraph = (status: DemoStepGraphStatus): DemoStepGraph => ({
	status,
	steps: [],
	truncated: false,
});

/**
 * Derives the linear demo step graph from cursor telemetry. Detection mirrors
 * the zoom-suggestion flow exactly: only explicit click events count, grouped
 * by `buildClickClusters` so rapid click pairs collapse into one step.
 */
export function deriveDemoStepGraph(params: DeriveDemoStepGraphParams): DemoStepGraph {
	const {
		cursorTelemetry,
		totalMs,
		maxSteps = DEFAULT_DEMO_STEP_CAP,
		contentRect = null,
		canvasWidth = 0,
		canvasHeight = 0,
		mergeGapMs = DEMO_STEP_MERGE_GAP_MS,
	} = params;

	if (!Number.isFinite(totalMs) || totalMs <= 0) {
		return emptyGraph("no-telemetry");
	}

	const normalized = normalizeCursorTelemetry(cursorTelemetry, totalMs);
	if (normalized.length === 0) {
		return emptyGraph("no-telemetry");
	}

	const explicitClicks = detectInteractionCandidates(normalized).filter(
		(candidate) => candidate.source === "explicit",
	);
	if (explicitClicks.length === 0) {
		return emptyGraph("no-interactions");
	}

	const clusters = buildClickClusters(explicitClicks, mergeGapMs);
	if (clusters.length === 0) {
		return emptyGraph("no-interactions");
	}

	const safeMaxSteps =
		Number.isFinite(maxSteps) && maxSteps >= 1 ? Math.floor(maxSteps) : DEFAULT_DEMO_STEP_CAP;
	const truncated = clusters.length > safeMaxSteps;

	const steps: DemoStep[] = clusters.slice(0, safeMaxSteps).map((cluster, index) => {
		const isLast = index === Math.min(clusters.length, safeMaxSteps) - 1;
		const timeMs = Math.max(0, Math.round(cluster.firstMs));
		if (isLast) {
			return { index, timeMs, advance: null };
		}
		const mapped = mapCursorToCanvasNormalized(
			{ cx: cluster.focus.cx, cy: cluster.focus.cy },
			{
				maskRect: contentRect,
				canvasWidth,
				canvasHeight,
			},
		);
		return {
			index,
			timeMs,
			advance: mapped ? { cx: mapped.cx, cy: mapped.cy } : null,
		};
	});

	return { status: "ok", steps, truncated };
}
