import type { CursorClickEffectStyle, ZoomDepth } from "./types";

/**
 * Motion profile — the user-facing dial for how much "magic" the editor
 * applies on its own. Suggested zooms respect the profile; zoom regions the
 * user creates or edits themselves are never changed or removed by it.
 */
export type MotionProfile = "off" | "subtle" | "balanced" | "energetic";

export const MOTION_PROFILES: readonly MotionProfile[] = ["off", "subtle", "balanced", "energetic"];

export const DEFAULT_MOTION_PROFILE: MotionProfile = "balanced";

/**
 * Maximum depth (ZoomRegion.depth, 1–6) a *suggested* zoom may use per
 * profile. `off` is 0 because suggestions are suppressed entirely; the
 * fallback there is the minimum depth of 1.
 */
export const MOTION_PROFILE_CAPS: Record<MotionProfile, number> = {
	off: 0,
	subtle: 2,
	balanced: 3,
	energetic: 4,
};

const MIN_ZOOM_DEPTH: ZoomDepth = 1;

export function normalizeMotionProfile(value: unknown): MotionProfile {
	return typeof value === "string" && (MOTION_PROFILES as readonly string[]).includes(value)
		? (value as MotionProfile)
		: DEFAULT_MOTION_PROFILE;
}

export function getSuggestedDepthCap(profile: MotionProfile): number {
	return MOTION_PROFILE_CAPS[profile];
}

/** Clamp a suggested zoom's depth to the profile cap (manual zooms never pass through here). */
export function clampSuggestedDepth(profile: MotionProfile, depth: ZoomDepth): ZoomDepth {
	const cap = MOTION_PROFILE_CAPS[profile];
	return Math.max(MIN_ZOOM_DEPTH, Math.min(depth, cap)) as ZoomDepth;
}

/** Cursor render settings a profile touches. */
export interface CursorMotionSettings {
	smoothing: number;
	clickEffect: CursorClickEffectStyle;
}

/**
 * The renderer treats the smoothing factor as "lower = smoother/slower"
 * (cursorRenderer.ts). Profiles bound the factor around the caller's value:
 * subtle keeps the follow gentle, energetic keeps it snappy. `off` forces
 * click effects off but never changes smoothing. `balanced` passes through.
 */
export const SUBTLE_MAX_CURSOR_SMOOTHING = 0.67;
export const ENERGETIC_MIN_CURSOR_SMOOTHING = 1;

export function applyProfileToCursorSettings(
	profile: MotionProfile,
	settings: CursorMotionSettings,
): CursorMotionSettings {
	const smoothing = Number.isFinite(settings.smoothing) ? settings.smoothing : 0;

	switch (profile) {
		case "off":
			return { smoothing, clickEffect: "none" };
		case "subtle":
			return {
				smoothing: Math.min(smoothing, SUBTLE_MAX_CURSOR_SMOOTHING),
				clickEffect: settings.clickEffect,
			};
		case "energetic":
			return {
				smoothing: Math.max(smoothing, ENERGETIC_MIN_CURSOR_SMOOTHING),
				clickEffect: settings.clickEffect,
			};
		default:
			return { smoothing, clickEffect: settings.clickEffect };
	}
}
