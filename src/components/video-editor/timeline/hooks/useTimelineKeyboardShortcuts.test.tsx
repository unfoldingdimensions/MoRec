// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TimelineShortcutBindings } from "../core/timelineTypes";
import { useTimelineKeyboardShortcuts } from "./useTimelineKeyboardShortcuts";

const BINDINGS = {
	addKeyframe: { key: "k", ctrl: true },
	addZoom: { key: "z", ctrl: true },
	splitClip: { key: "s", ctrl: true },
	addAnnotation: { key: "d", ctrl: true },
	deleteSelected: { key: "Delete", ctrl: true },
} as unknown as TimelineShortcutBindings;

function createParams(overrides: Partial<Record<string, unknown>> = {}) {
	return {
		isMac: false,
		keyShortcuts: BINDINGS,
		isTimelineFocusedRef: { current: true },
		hasAnyZoomBlocks: true,
		activateSelectAllZooms: vi.fn(),
		annotationCount: 0,
		selectedKeyframeId: null,
		selectedZoomId: null,
		selectedClipId: null,
		selectedAnnotationId: null,
		selectedAudioId: null,
		selectedCaptionId: null,
		selectAllBlocksActive: false,
		addKeyframe: vi.fn(),
		handleAddZoom: vi.fn(),
		handleSplitClip: vi.fn(),
		handleAddAnnotation: vi.fn(),
		deleteSelectedKeyframe: vi.fn(),
		deleteSelectedZoom: vi.fn(),
		deleteSelectedClip: vi.fn(),
		deleteSelectedAnnotation: vi.fn(),
		deleteSelectedAudio: vi.fn(),
		deleteSelectedCaption: vi.fn(),
		cycleAnnotationsAtCurrentTime: vi.fn(() => true),
		...overrides,
	} as Parameters<typeof useTimelineKeyboardShortcuts>[0];
}

function pressKey(key: string, init: KeyboardEventInit = {}) {
	const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
	const preventDefault = vi.spyOn(event, "preventDefault");
	window.dispatchEvent(event);
	return { event, preventDefault };
}

describe("useTimelineKeyboardShortcuts", () => {
	let keydownListeners: Array<(e: KeyboardEvent) => void>;

	beforeEach(() => {
		keydownListeners = [];
		// Spy but call through: dispatchEvent only reaches listeners registered
		// with the real window registry.
		const realAdd = window.addEventListener.bind(window);
		const realRemove = window.removeEventListener.bind(window);
		vi.spyOn(window, "addEventListener").mockImplementation(((type: string, listener: (e: KeyboardEvent) => void, options?: unknown) => {
			if (type === "keydown") keydownListeners.push(listener);
			return realAdd(type, listener as EventListener, options);
		}) as never);
		vi.spyOn(window, "removeEventListener").mockImplementation(((type: string, listener: (e: KeyboardEvent) => void, options?: unknown) => {
			keydownListeners = keydownListeners.filter((candidate) => candidate !== listener);
			return realRemove(type, listener as EventListener, options);
		}) as never);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("registers and removes the keydown listener across mounts", () => {
		const { unmount } = renderHook(() => useTimelineKeyboardShortcuts(createParams()));
		expect(keydownListeners).toHaveLength(1);
		unmount();
		expect(keydownListeners).toHaveLength(0);
	});

	it("ignores keys when the timeline is not focused", () => {
		const params = createParams({ isTimelineFocusedRef: { current: false } });
		renderHook(() => useTimelineKeyboardShortcuts(params));

		pressKey("s", { ctrlKey: true });
		expect(params.handleSplitClip).not.toHaveBeenCalled();
	});

	it("ignores keys typed into inputs and editable targets", () => {
		const input = document.createElement("input");
		document.body.appendChild(input);
		const params = createParams();
		renderHook(() => useTimelineKeyboardShortcuts(params));

		const event = new KeyboardEvent("keydown", {
			key: "s",
			ctrlKey: true,
			bubbles: true,
			cancelable: true,
		});
		Object.defineProperty(event, "target", { value: input });
		window.dispatchEvent(event);

		expect(params.handleSplitClip).not.toHaveBeenCalled();
		input.remove();
	});

	it("select all zooms on ctrl/cmd+a only when zoom blocks exist", () => {
		const params = createParams();
		renderHook(() => useTimelineKeyboardShortcuts(params));
		const { preventDefault } = pressKey("a", { ctrlKey: true });
		expect(params.activateSelectAllZooms).toHaveBeenCalledTimes(1);
		expect(preventDefault).toHaveBeenCalled();

		const withoutZooms = createParams({ hasAnyZoomBlocks: false });
		renderHook(() => useTimelineKeyboardShortcuts(withoutZooms));
		pressKey("a", { ctrlKey: true });
		expect(withoutZooms.activateSelectAllZooms).not.toHaveBeenCalled();
	});

	it("dispatches bound actions", () => {
		const params = createParams();
		renderHook(() => useTimelineKeyboardShortcuts(params));

		pressKey("s", { ctrlKey: true });
		expect(params.handleSplitClip).toHaveBeenCalledTimes(1);
		pressKey("k", { ctrlKey: true });
		expect(params.addKeyframe).toHaveBeenCalledTimes(1);
		pressKey("z", { ctrlKey: true });
		expect(params.handleAddZoom).toHaveBeenCalledTimes(1);
		pressKey("d", { ctrlKey: true });
		expect(params.handleAddAnnotation).toHaveBeenCalledTimes(1);
	});

	it("deletes the selected clip on Delete and nothing when selection is empty", () => {
		const params = createParams({ selectedClipId: "clip-1" });
		renderHook(() => useTimelineKeyboardShortcuts(params));
		const { preventDefault } = pressKey("Delete");
		expect(params.deleteSelectedClip).toHaveBeenCalledTimes(1);
		expect(preventDefault).toHaveBeenCalled();

		const empty = createParams();
		renderHook(() => useTimelineKeyboardShortcuts(empty));
		pressKey("Delete");
		expect(empty.deleteSelectedClip).not.toHaveBeenCalled();
	});

	it("cycles annotations on Tab only when annotations exist", () => {
		const params = createParams({ annotationCount: 2 });
		renderHook(() => useTimelineKeyboardShortcuts(params));
		const { preventDefault } = pressKey("Tab", { shiftKey: true });
		expect(params.cycleAnnotationsAtCurrentTime).toHaveBeenCalledWith(true);
		expect(preventDefault).toHaveBeenCalled();

		const noAnnotations = createParams({ annotationCount: 0 });
		renderHook(() => useTimelineKeyboardShortcuts(noAnnotations));
		pressKey("Tab");
		expect(noAnnotations.cycleAnnotationsAtCurrentTime).not.toHaveBeenCalled();
	});
});
