import { describe, expect, it } from "vitest";

import {
	resolveWindowsCaptureDisplay,
	resolveWindowsCaptureTarget,
} from "./windowsCaptureSelection";

describe("resolveWindowsCaptureDisplay", () => {
	const primaryDisplay = {
		id: 101,
		bounds: {
			x: 0,
			y: 0,
			width: 1920,
			height: 1080,
		},
	};

	const secondaryDisplay = {
		id: 202,
		bounds: {
			x: 1920,
			y: -40,
			width: 2560,
			height: 1440,
		},
		scaleFactor: 1.5,
	};

	it("uses the requested secondary display bounds for WGC fallback metadata", () => {
		const resolved = resolveWindowsCaptureDisplay(
			{ display_id: String(secondaryDisplay.id) },
			[primaryDisplay, secondaryDisplay],
			primaryDisplay,
		);

		expect(resolved).toEqual({
			displayId: secondaryDisplay.id,
			bounds: secondaryDisplay.bounds,
			scaleFactor: 1.5,
		});
	});

	it("falls back to the primary display when the source has no display id", () => {
		const resolved = resolveWindowsCaptureDisplay(
			undefined,
			[primaryDisplay, secondaryDisplay],
			primaryDisplay,
		);

		expect(resolved).toEqual({
			displayId: primaryDisplay.id,
			bounds: primaryDisplay.bounds,
			scaleFactor: 1,
		});
	});

	it("returns null when the requested display id no longer matches any live display", () => {
		const resolved = resolveWindowsCaptureDisplay(
			{ display_id: "303" },
			[primaryDisplay, secondaryDisplay],
			primaryDisplay,
		);

		expect(resolved).toBeNull();
	});
});

describe("resolveWindowsCaptureTarget", () => {
	const primaryDisplay = {
		id: 101,
		bounds: {
			x: 0,
			y: 0,
			width: 1920,
			height: 1080,
		},
	};

	const secondaryDisplay = {
		id: 202,
		bounds: {
			x: 1920,
			y: -40,
			width: 2560,
			height: 1440,
		},
		scaleFactor: 1.5,
	};

	it("uses a window handle when a Windows window source is selected", () => {
		const resolved = resolveWindowsCaptureTarget(
			{ id: "window:123456:0", sourceType: "window" },
			[primaryDisplay, secondaryDisplay],
			primaryDisplay,
		);

		expect(resolved).toEqual({
			kind: "window",
			windowHandle: 123456,
		});
	});

	it("does not silently turn an invalid window source into display capture", () => {
		const resolved = resolveWindowsCaptureTarget(
			{ id: "window:0:0", sourceType: "window", display_id: String(secondaryDisplay.id) },
			[primaryDisplay, secondaryDisplay],
			primaryDisplay,
		);

		expect(resolved).toEqual({
			kind: "invalid-window",
		});
	});

	it("does not silently record the primary when the selected display is gone", () => {
		const resolved = resolveWindowsCaptureTarget(
			{ id: "screen:303:0", sourceType: "screen", display_id: "303" },
			[primaryDisplay, secondaryDisplay],
			primaryDisplay,
		);

		expect(resolved).toEqual({ kind: "invalid-display" });
	});

	it("keeps display capture behavior for selected screens", () => {
		const resolved = resolveWindowsCaptureTarget(
			{ id: "screen:202:0", sourceType: "screen", display_id: String(secondaryDisplay.id) },
			[primaryDisplay, secondaryDisplay],
			primaryDisplay,
		);

		expect(resolved).toEqual({
			kind: "display",
			displayId: secondaryDisplay.id,
			bounds: secondaryDisplay.bounds,
			scaleFactor: 1.5,
		});
	});
});
