import { type RefObject, useEffect } from "react";
import { matchesShortcut } from "@/lib/shortcuts";
import type { TimelineShortcutBindings } from "../core/timelineTypes";
import { resolveDeleteSelectionTarget } from "./utils/timelineSelectionUtils";

interface UseTimelineKeyboardShortcutsParams {
	keyShortcuts: TimelineShortcutBindings;
	isTimelineFocusedRef: RefObject<boolean>;
	hasAnyZoomBlocks: boolean;
	activateSelectAllZooms: () => void;
	annotationCount: number;
	selectedKeyframeId: string | null;
	selectedZoomId: string | null;
	selectedClipId?: string | null;
	selectedAnnotationId?: string | null;
	selectedAudioId?: string | null;
	selectedCaptionId?: string | null;
	selectAllBlocksActive: boolean;
	addKeyframe: () => void;
	handleAddZoom: () => void;
	handleSplitClip: () => void;
	handleAddAnnotation: () => void;
	deleteSelectedKeyframe: () => void;
	deleteSelectedZoom: () => void;
	deleteSelectedClip: () => void;
	deleteSelectedAnnotation: () => void;
	deleteSelectedAudio: () => void;
	deleteSelectedCaption: () => void;
	cycleAnnotationsAtCurrentTime: (backward?: boolean) => boolean;
}

export function useTimelineKeyboardShortcuts({
	keyShortcuts,
	isTimelineFocusedRef,
	hasAnyZoomBlocks,
	activateSelectAllZooms,
	annotationCount,
	selectedKeyframeId,
	selectedZoomId,
	selectedClipId,
	selectedAnnotationId,
	selectedAudioId,
	selectedCaptionId,
	selectAllBlocksActive,
	addKeyframe,
	handleAddZoom,
	handleSplitClip,
	handleAddAnnotation,
	deleteSelectedKeyframe,
	deleteSelectedZoom,
	deleteSelectedClip,
	deleteSelectedAnnotation,
	deleteSelectedAudio,
	deleteSelectedCaption,
	cycleAnnotationsAtCurrentTime,
}: UseTimelineKeyboardShortcutsParams) {
	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			const eventTarget = e.target;
			if (
				eventTarget instanceof HTMLInputElement ||
				eventTarget instanceof HTMLTextAreaElement ||
				eventTarget instanceof HTMLSelectElement ||
				(eventTarget instanceof HTMLElement && eventTarget.isContentEditable)
			) {
				return;
			}

			if (!isTimelineFocusedRef.current) {
				return;
			}

			if (matchesShortcut(e, { key: "a", ctrl: true })) {
				if (!hasAnyZoomBlocks) {
					return;
				}
				e.preventDefault();
				activateSelectAllZooms();
				return;
			}

			if (matchesShortcut(e, keyShortcuts.addKeyframe)) {
				e.preventDefault();
				addKeyframe();
			}
			if (matchesShortcut(e, keyShortcuts.addZoom)) {
				e.preventDefault();
				handleAddZoom();
			}
			if (matchesShortcut(e, keyShortcuts.splitClip)) {
				e.preventDefault();
				handleSplitClip();
			}
			if (matchesShortcut(e, keyShortcuts.addAnnotation)) {
				e.preventDefault();
				handleAddAnnotation();
			}

			if (e.key === "Tab" && annotationCount > 0) {
				if (cycleAnnotationsAtCurrentTime(e.shiftKey)) {
					e.preventDefault();
				}
			}

			if (
				e.key === "Delete" ||
				e.key === "Backspace" ||
				matchesShortcut(e, keyShortcuts.deleteSelected)
			) {
				const target = resolveDeleteSelectionTarget({
					selectAllBlocksActive,
					selectedKeyframeId,
					selectedZoomId,
					selectedClipId,
					selectedAnnotationId,
					selectedAudioId,
					selectedCaptionId,
				});
				if (target !== "none") {
					e.preventDefault();
				}
				if (target === "keyframe") {
					deleteSelectedKeyframe();
				} else if (target === "zoom") {
					deleteSelectedZoom();
				} else if (target === "clip") {
					deleteSelectedClip();
				} else if (target === "annotation") {
					deleteSelectedAnnotation();
				} else if (target === "audio") {
					deleteSelectedAudio();
				} else if (target === "caption") {
					deleteSelectedCaption();
				}
			}
		};

		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [
		activateSelectAllZooms,
		addKeyframe,
		annotationCount,
		cycleAnnotationsAtCurrentTime,
		deleteSelectedAnnotation,
		deleteSelectedAudio,
		deleteSelectedCaption,
		deleteSelectedClip,
		deleteSelectedKeyframe,
		deleteSelectedZoom,
		handleAddAnnotation,
		handleAddZoom,
		handleSplitClip,
		hasAnyZoomBlocks,
		isTimelineFocusedRef,
		keyShortcuts,
		selectAllBlocksActive,
		selectedAnnotationId,
		selectedAudioId,
		selectedCaptionId,
		selectedClipId,
		selectedKeyframeId,
		selectedZoomId,
	]);
}
