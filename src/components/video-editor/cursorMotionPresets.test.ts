import { describe, expect, it } from "vitest";
import {
	CURSOR_MOTION_PRESETS,
	getMatchingCursorMotionPresetId,
	resolveCursorMotionPresetId,
} from "./cursorMotionPresets";

describe("cursorMotionPresets", () => {
	it("identifies the focused preset accurately", () => {
		const focusedInput = { ...CURSOR_MOTION_PRESETS.focused };
		expect(getMatchingCursorMotionPresetId(focusedInput)).toBe("focused");
	});

	it("identifies the smooth preset accurately", () => {
		const smoothInput = { ...CURSOR_MOTION_PRESETS.smooth };
		expect(getMatchingCursorMotionPresetId(smoothInput)).toBe("smooth");
	});

	it("matches presets despite minor floating point precision errors", () => {
		const focusedWithFloatDrift = {
			...CURSOR_MOTION_PRESETS.focused,
			cursorSpringDampingMultiplier: 0.7900000000000001,
			cursorSmoothing: 0.6700000000000002,
		};
		expect(getMatchingCursorMotionPresetId(focusedWithFloatDrift)).toBe("focused");
	});

	it("returns null when user customizes any motion parameter", () => {
		const customCursorSize = {
			...CURSOR_MOTION_PRESETS.focused,
			cursorSize: 3.2,
		};
		expect(getMatchingCursorMotionPresetId(customCursorSize)).toBeNull();

		const customSpringStiffness = {
			...CURSOR_MOTION_PRESETS.smooth,
			cursorSpringStiffnessMultiplier: 1.5,
		};
		expect(getMatchingCursorMotionPresetId(customSpringStiffness)).toBeNull();

		const customZoomDuration = {
			...CURSOR_MOTION_PRESETS.focused,
			zoomInDurationMs: 350,
		};
		expect(getMatchingCursorMotionPresetId(customZoomDuration)).toBeNull();
	});

	it("resolveCursorMotionPresetId returns fallback when customized", () => {
		const customValues = {
			...CURSOR_MOTION_PRESETS.focused,
			cursorSize: 4.0,
		};
		expect(resolveCursorMotionPresetId(customValues, "focused")).toBe("focused");
		expect(resolveCursorMotionPresetId(customValues, "smooth")).toBe("smooth");
	});
});
