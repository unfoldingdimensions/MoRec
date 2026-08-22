import { useTimelineContext } from "dnd-timeline";
import React, { useEffect, useState } from "react";
import { useI18n } from "@/contexts/I18nContext";

interface Keyframe {
	id: string;
	time: number;
}

interface KeyframeMarkersProps {
	keyframes: Keyframe[];
	selectedKeyframeId: string | null;
	setSelectedKeyframeId: (id: string | null) => void;
	onKeyframeMove: (id: string, newTime: number) => void;
	videoDurationMs: number;
	timelineRef: React.RefObject<HTMLDivElement>;
}

const KeyframeMarkers: React.FC<KeyframeMarkersProps> = ({
	keyframes,
	selectedKeyframeId,
	setSelectedKeyframeId,
	onKeyframeMove,
	videoDurationMs,
	timelineRef,
}) => {
	const { sidebarWidth, range, valueToPixels, pixelsToValue, direction } = useTimelineContext();
	const { t } = useI18n();
	const sideProperty = direction === "rtl" ? "right" : "left";
	const [draggingKeyframeId, setDraggingKeyframeId] = useState<string | null>(null);

	useEffect(() => {
		if (!draggingKeyframeId) return;

		const handleMouseMove = (e: MouseEvent) => {
			if (!timelineRef.current) return;

			const rect = timelineRef.current.getBoundingClientRect();
			// Mirror TimelineCanvas's RTL hit-testing (measure from rect.right).
			const clickX =
				direction === "rtl"
					? rect.right - sidebarWidth - e.clientX
					: e.clientX - rect.left - sidebarWidth;
			const relativeMs = pixelsToValue(clickX);
			const absoluteMs = Math.max(0, Math.min(range.start + relativeMs, videoDurationMs));

			// Update the keyframe position in real-time
			onKeyframeMove(draggingKeyframeId, absoluteMs);
		};

		const handleMouseUp = () => {
			setDraggingKeyframeId(null);
			document.body.style.cursor = "";
		};

		window.addEventListener("mousemove", handleMouseMove);
		window.addEventListener("mouseup", handleMouseUp);
		document.body.style.cursor = "ew-resize";

		return () => {
			window.removeEventListener("mousemove", handleMouseMove);
			window.removeEventListener("mouseup", handleMouseUp);
			document.body.style.cursor = "";
		};
	}, [
		draggingKeyframeId,
		onKeyframeMove,
		timelineRef,
		sidebarWidth,
		direction,
		range.start,
		videoDurationMs,
		pixelsToValue,
	]);

	return (
		<>
			{keyframes.map((kf) => {
				const offset = valueToPixels(kf.time - range.start);
				const isSelected = kf.id === selectedKeyframeId;
				const isDragging = kf.id === draggingKeyframeId;

				return (
					<div
						key={kf.id}
						className={`absolute top-8 cursor-grab active:cursor-grabbing ${isSelected ? "ring-2 ring-[#2563EB]" : ""}`}
					style={{
						[sideProperty]: `${sidebarWidth + offset - 8}px`,
						zIndex: isDragging ? 50 : 40,
						transition: isDragging ? "none" : `${sideProperty} 0.1s ease-out`,
					}}
						onMouseDown={(e) => {
							e.stopPropagation();
							setSelectedKeyframeId(kf.id);
							if (e.button !== 0) {
								return;
							}
							setDraggingKeyframeId(kf.id);
						}}
						onContextMenu={(e) => {
							e.preventDefault();
							e.stopPropagation();
							setSelectedKeyframeId(kf.id);
						}}
						title={t(
							"timeline.keyframeTooltip",
							undefined,
							{ time: Math.round(kf.time) },
						)}
					>
						<div
							style={{
								width: "10px",
								height: "10px",
								background: "#ffe100ff",
								transform: "rotate(45deg)",
								border: "none",
								opacity: isSelected ? 1 : 0.6,
								transition: "opacity 0.15s",
							}}
						/>
					</div>
				);
			})}
		</>
	);
};

export default KeyframeMarkers;
