// @vitest-environment jsdom
import { act } from "@testing-library/react";
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CursorTelemetryPoint, ZoomDepth } from "../../../types";
import { DEFAULT_AUTO_ZOOM_DEPTH } from "../../../types";
import { MOTION_PROFILE_CAPS } from "../../../motionProfile";
import { useTimelineZoomActions } from "./useTimelineZoomActions";

const { timelineNotifications } = vi.hoisted(() => ({
	timelineNotifications: {
		error: vi.fn(),
		info: vi.fn(),
		success: vi.fn(),
	},
}));

vi.mock("../utils/timelineNotifications", () => ({ timelineNotifications }));

function clickPair(): CursorTelemetryPoint[] {
	return [
		{ timeMs: 1000, cx: 0.3, cy: 0.3, interactionType: "click" },
		{ timeMs: 1600, cx: 0.32, cy: 0.3, interactionType: "click" },
	];
}

function createParams(
	overrides: Partial<Parameters<typeof useTimelineZoomActions>[0]> = {},
): Parameters<typeof useTimelineZoomActions>[0] {
	return {
		timeline: { videoDuration: 10, totalMs: 10000, currentTimeMs: 0 },
		regions: { zoom: [], clip: [] },
		cursorTelemetry: clickPair(),
		options: { disableSuggestedZooms: false },
		autoSuggestZoomsTrigger: 0,
		onAutoSuggestZoomsConsumed: vi.fn(),
		onZoomAdded: vi.fn(),
		onZoomSuggested: vi.fn(),
		...overrides,
	};
}

function renderAndSuggest(params: Parameters<typeof useTimelineZoomActions>[0]) {
	const onZoomSuggested = params.onZoomSuggested;
	const { result } = renderHook(() => useTimelineZoomActions(params));
	act(() => {
		result.current.handleSuggestZooms();
	});
	return { onZoomSuggested, notifications: timelineNotifications };
}

describe("useTimelineZoomActions — motion profile", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("suppresses suggestions entirely when the profile is off", () => {
		const { onZoomSuggested, notifications } = renderAndSuggest(
			createParams({ options: { disableSuggestedZooms: false, motionProfile: "off" } }),
		);

		expect(onZoomSuggested).not.toHaveBeenCalled();
		expect(notifications.info).toHaveBeenCalledWith(
			"Suggested zooms are turned off",
			expect.any(String),
		);
	});

	it("suppresses suggestions even when the generic disable flag would allow them", () => {
		const params = createParams({
			options: { disableSuggestedZooms: false, motionProfile: "off" },
		});
		const { result } = renderHook(() => useTimelineZoomActions(params));
		act(() => {
			result.current.handleSuggestZooms();
		});

		expect(timelineNotifications.info).toHaveBeenCalledWith(
			"Suggested zooms are turned off",
			expect.any(String),
		);
		expect(timelineNotifications.info).not.toHaveBeenCalledWith(
			expect.stringContaining("cursor looping"),
		);
	});

	it("clamps suggested depth to the profile cap for each level", () => {
		for (const profile of ["subtle", "balanced", "energetic"] as const) {
			vi.clearAllMocks();
			const { onZoomSuggested } = renderAndSuggest(
				createParams({ options: { disableSuggestedZooms: false, motionProfile: profile } }),
			);

			expect(onZoomSuggested).toHaveBeenCalled();
			for (const call of onZoomSuggested.mock.calls) {
				const depth = call[2] as ZoomDepth;
				expect(depth).toBeLessThanOrEqual(MOTION_PROFILE_CAPS[profile]);
				expect(depth).toBeGreaterThanOrEqual(1);
			}
		}
	});

	it("passes the default auto depth through the balanced profile unchanged", () => {
		const { onZoomSuggested } = renderAndSuggest(
			createParams({ options: { disableSuggestedZooms: false, motionProfile: "balanced" } }),
		);

		expect(onZoomSuggested).toHaveBeenCalled();
		for (const call of onZoomSuggested.mock.calls) {
			expect(call[2]).toBe(DEFAULT_AUTO_ZOOM_DEPTH);
		}
		expect(timelineNotifications.success).toHaveBeenCalled();
	});
});
