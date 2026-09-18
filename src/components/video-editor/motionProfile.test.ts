import { describe, expect, it } from "vitest";

import type { ZoomDepth } from "./types";
import {
	applyProfileToCursorSettings,
	clampSuggestedDepth,
	DEFAULT_MOTION_PROFILE,
	getSuggestedDepthCap,
	MOTION_PROFILE_CAPS,
	MOTION_PROFILES,
	normalizeMotionProfile,
	SUBTLE_MAX_CURSOR_SMOOTHING,
	ENERGETIC_MIN_CURSOR_SMOOTHING,
} from "./motionProfile";

describe("motionProfile", () => {
	it("exposes the four profile levels in display order", () => {
		expect(MOTION_PROFILES).toEqual(["off", "subtle", "balanced", "energetic"]);
	});

	it("defaults to balanced", () => {
		expect(DEFAULT_MOTION_PROFILE).toBe("balanced");
	});

	it("defines the planned depth caps per profile", () => {
		expect(MOTION_PROFILE_CAPS).toEqual({
			off: 0,
			subtle: 2,
			balanced: 3,
			energetic: 4,
		});
	});

	it("normalizes unknown values back to balanced", () => {
		expect(normalizeMotionProfile("balanced")).toBe("balanced");
		expect(normalizeMotionProfile("off")).toBe("off");
		expect(normalizeMotionProfile("subtle")).toBe("subtle");
		expect(normalizeMotionProfile("energetic")).toBe("energetic");
		expect(normalizeMotionProfile("maximum")).toBe("balanced");
		expect(normalizeMotionProfile("")).toBe("balanced");
		expect(normalizeMotionProfile(null)).toBe("balanced");
		expect(normalizeMotionProfile(undefined)).toBe("balanced");
		expect(normalizeMotionProfile(3)).toBe("balanced");
		expect(normalizeMotionProfile({ profile: "off" })).toBe("balanced");
	});

	it("clamps suggested depth to the profile cap", () => {
		expect(clampSuggestedDepth("subtle", 4)).toBe(2);
		expect(clampSuggestedDepth("balanced", 2)).toBe(2);
		expect(clampSuggestedDepth("balanced", 5)).toBe(3);
		expect(clampSuggestedDepth("energetic", 6)).toBe(4);
	});

	it("keeps suggested depths below the cap untouched", () => {
		expect(clampSuggestedDepth("subtle", 1)).toBe(1);
		expect(clampSuggestedDepth("energetic", 3)).toBe(3);
	});

	it("never returns a depth below 1, including for the off profile", () => {
		expect(clampSuggestedDepth("off", 3)).toBe(1);
		expect(clampSuggestedDepth("off", 1)).toBe(1);
	});

	it("reports caps through getSuggestedDepthCap", () => {
		expect(getSuggestedDepthCap("off")).toBe(0);
		expect(getSuggestedDepthCap("subtle")).toBe(2);
		expect(getSuggestedDepthCap("balanced")).toBe(3);
		expect(getSuggestedDepthCap("energetic")).toBe(4);
	});

	it("passes cursor settings through unchanged for balanced", () => {
		expect(
			applyProfileToCursorSettings("balanced", {
				smoothing: 1.4,
				clickEffect: "ripple",
			}),
		).toEqual({ smoothing: 1.4, clickEffect: "ripple" });
	});

	it("forces click effects off for the off profile without touching smoothing", () => {
		expect(
			applyProfileToCursorSettings("off", {
				smoothing: 0.9,
				clickEffect: "echo",
			}),
		).toEqual({ smoothing: 0.9, clickEffect: "none" });
	});

	it("keeps smoothing gentle for the subtle profile", () => {
		expect(
			applyProfileToCursorSettings("subtle", {
				smoothing: 1.4,
				clickEffect: "spotlight",
			}),
		).toEqual({ smoothing: SUBTLE_MAX_CURSOR_SMOOTHING, clickEffect: "spotlight" });
		expect(
			applyProfileToCursorSettings("subtle", {
				smoothing: 0.3,
				clickEffect: "none",
			}).smoothing,
		).toBe(0.3);
	});

	it("keeps the cursor snappy for the energetic profile", () => {
		expect(
			applyProfileToCursorSettings("energetic", {
				smoothing: 0.4,
				clickEffect: "none",
			}),
		).toEqual({ smoothing: ENERGETIC_MIN_CURSOR_SMOOTHING, clickEffect: "none" });
		expect(
			applyProfileToCursorSettings("energetic", {
				smoothing: 1.8,
				clickEffect: "ripple",
			}).smoothing,
		).toBe(1.8);
	});

	it("treats non-finite smoothing as 0 before applying a profile", () => {
		expect(
			applyProfileToCursorSettings("energetic", {
				smoothing: Number.NaN,
				clickEffect: "none",
			}).smoothing,
		).toBe(ENERGETIC_MIN_CURSOR_SMOOTHING);
		expect(
			applyProfileToCursorSettings("balanced", {
				smoothing: Number.NaN,
				clickEffect: "none",
			}).smoothing,
		).toBe(0);
	});

	it("keeps clamp results within the valid ZoomDepth range", () => {
		const depths: ZoomDepth[] = [1, 2, 3, 4, 5, 6];
		for (const profile of MOTION_PROFILES) {
			for (const depth of depths) {
				const clamped = clampSuggestedDepth(profile, depth);
				expect(clamped).toBeGreaterThanOrEqual(1);
				expect(clamped).toBeLessThanOrEqual(6);
				expect(Number.isInteger(clamped)).toBe(true);
			}
		}
	});
});
