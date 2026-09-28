import { CaretDownIcon, CaretUpIcon, XIcon } from "@phosphor-icons/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useScopedT } from "@/contexts/I18nContext";
import { loadAppSetting, saveAppSetting } from "@/lib/appSettings";
import {
	advancePrompterOffset,
	clampPrompterOffset,
	createPrompterScrollAnchor,
} from "./prompterScroll";
import styles from "./LaunchWindow.module.css";

const DRAG_THRESHOLD_PX = 5;
const POSITION_SETTING_KEY = "teleprompterPosition";

/** Persisted panel position: top-left corner in viewport px. */
type PrompterPosition = { x: number; y: number };

function readPersistedPosition(): PrompterPosition | null {
	const stored = loadAppSetting<Partial<PrompterPosition>>(POSITION_SETTING_KEY);
	if (
		!stored ||
		typeof stored.x !== "number" ||
		!Number.isFinite(stored.x) ||
		typeof stored.y !== "number" ||
		!Number.isFinite(stored.y)
	) {
		return null;
	}
	return { x: stored.x, y: stored.y };
}

function clampPositionToViewport(position: PrompterPosition): PrompterPosition {
	if (typeof window === "undefined") {
		return position;
	}
	const margin = 8;
	const maxX = Math.max(margin, window.innerWidth - margin);
	const maxY = Math.max(margin, window.innerHeight - margin);
	return {
		x: Math.min(Math.max(position.x, -window.innerWidth + 120), maxX - 120),
		y: Math.min(Math.max(position.y, 0), maxY - 48),
	};
}

/**
 * Collapsible auto-scrolling teleprompter shown in the HUD overlay while
 * recording. Auto-scrolls at the configured speed, tap/click to pause, drag to
 * scroll manually. Like the rest of the HUD it is governed by the
 * hideHudFromCapture capture-protection toggle (it lives in the HUD window).
 */
export function TeleprompterPrompter({
	notes,
	fontSize,
	scrollSpeed,
	recording,
	paused,
	onClose,
}: {
	notes: string;
	fontSize: number;
	scrollSpeed: number;
	recording: boolean;
	paused: boolean;
	onClose: () => void;
}) {
	const t = useScopedT("launch");
	const scrollRef = useRef<HTMLDivElement | null>(null);
	const anchorRef = useRef(createPrompterScrollAnchor());
	const clockMsRef = useRef(0);
	const lastFrameMsRef = useRef<number | null>(null);
	const [userPaused, setUserPaused] = useState(false);
	const [atEnd, setAtEnd] = useState(false);
	// V2: free panel positioning. null keeps the fixed right-third default.
	const [position, setPosition] = useState<PrompterPosition | null>(null);
	const positionLoadedRef = useRef(false);

	useEffect(() => {
		if (positionLoadedRef.current) {
			return;
		}
		positionLoadedRef.current = true;
		const persisted = readPersistedPosition();
		if (persisted) {
			setPosition(clampPositionToViewport(persisted));
		}
	}, []);

	const autoScrollActive = recording && !paused && !userPaused && !atEnd;

	// Reset the scroll clock whenever a recording (re)starts.
	useEffect(() => {
		if (recording) {
			anchorRef.current = createPrompterScrollAnchor();
			clockMsRef.current = 0;
			lastFrameMsRef.current = null;
			setUserPaused(false);
			setAtEnd(false);
		}
	}, [recording]);

	useEffect(() => {
		if (!autoScrollActive) {
			lastFrameMsRef.current = null;
			return;
		}

		let raf = 0;
		const tick = (nowMs: number) => {
			const last = lastFrameMsRef.current;
			lastFrameMsRef.current = nowMs;
			if (last !== null) {
				clockMsRef.current += Math.min(250, nowMs - last);
			}

			const container = scrollRef.current;
			if (container) {
				const maxOffset = container.scrollHeight - container.clientHeight;
				const target = clampPrompterOffset(
					advancePrompterOffset(anchorRef.current, clockMsRef.current, scrollSpeed),
					maxOffset,
				);
				container.scrollTop = target;
				// Only a scrollable document can reach its end; short notes just
				// keep the prompter in the playing state.
				if (maxOffset > 0 && target >= maxOffset) {
					setAtEnd(true);
					return;
				}
			}

			raf = requestAnimationFrame(tick);
		};

		raf = requestAnimationFrame(tick);
		return () => cancelAnimationFrame(raf);
	}, [autoScrollActive, scrollSpeed]);

	// Resume auto-scroll from the current position.
	const resumeAutoScroll = useCallback(() => {
		const container = scrollRef.current;
		const maxOffset = container ? container.scrollHeight - container.clientHeight : 0;
		const offset = clampPrompterOffset(container?.scrollTop ?? 0, maxOffset);
		if (offset >= maxOffset) {
			anchorRef.current = createPrompterScrollAnchor();
			clockMsRef.current = 0;
		} else {
			anchorRef.current = createPrompterScrollAnchor(offset, clockMsRef.current);
		}
		setAtEnd(false);
		setUserPaused(false);
	}, []);

	const pauseAutoScroll = useCallback(() => {
		setUserPaused(true);
	}, []);

	const dragStateRef = useRef<{
		pointerId: number;
		startY: number;
		startScrollTop: number;
		moved: boolean;
	} | null>(null);

	const handlePointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
		const container = scrollRef.current;
		if (!container) return;
		dragStateRef.current = {
			pointerId: event.pointerId,
			startY: event.clientY,
			startScrollTop: container.scrollTop,
			moved: false,
		};
	}, []);

	const handlePointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
		const drag = dragStateRef.current;
		const container = scrollRef.current;
		if (!drag || !container || drag.pointerId !== event.pointerId) return;

		const deltaY = event.clientY - drag.startY;
		if (!drag.moved && Math.abs(deltaY) < DRAG_THRESHOLD_PX) return;

		if (!drag.moved) {
			drag.moved = true;
			setUserPaused(true);
		}
		const maxOffset = container.scrollHeight - container.clientHeight;
		container.scrollTop = clampPrompterOffset(drag.startScrollTop - deltaY, maxOffset);
	}, []);

	const handlePointerUp = useCallback(
		(event: React.PointerEvent<HTMLDivElement>) => {
			const drag = dragStateRef.current;
			dragStateRef.current = null;
			if (!drag || drag.pointerId !== event.pointerId) return;

			if (drag.moved) {
				// Manual scroll leaves the prompter paused; tap resumes.
				return;
			}
			if (userPaused || atEnd) {
				resumeAutoScroll();
			} else {
				pauseAutoScroll();
			}
		},
		[atEnd, pauseAutoScroll, resumeAutoScroll, userPaused],
	);

	const prompterStateLabel = !recording
		? t("recording.prompterPause")
		: userPaused || paused || atEnd
			? t("recording.prompterResume")
			: t("recording.prompterPause");

	// Header drag moves the whole panel (buttons in the header still click —
	// drags only start past the movement threshold and never on a button).
	const moveStateRef = useRef<{
		pointerId: number;
		startX: number;
		startY: number;
		baseX: number;
		baseY: number;
		moved: boolean;
	} | null>(null);
	const latestPositionRef = useRef<PrompterPosition | null>(position);
	latestPositionRef.current = position;

	const handleMovePointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
		if (event.target instanceof Element && event.target.closest("button")) {
			return;
		}
		moveStateRef.current = {
			pointerId: event.pointerId,
			startX: event.clientX,
			startY: event.clientY,
			baseX: position?.x ?? 0,
			baseY: position?.y ?? 0,
			moved: false,
		};
		// Pointer capture keeps the drag alive outside the header; jsdom and
		// older runtimes lack the API, where per-event hit testing still works.
		event.currentTarget.setPointerCapture?.(event.pointerId);
	}, [position]);

	const handleMovePointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
		const move = moveStateRef.current;
		if (!move || move.pointerId !== event.pointerId) return;

		const deltaX = event.clientX - move.startX;
		const deltaY = event.clientY - move.startY;
		if (!move.moved && Math.hypot(deltaX, deltaY) < DRAG_THRESHOLD_PX) return;

		if (!move.moved) {
			move.moved = true;
			// First move past the threshold re-bases on the default position so
			// the panel does not jump when it was still at the right-third spot.
			const panel = event.currentTarget.parentElement;
			const rect = panel?.getBoundingClientRect();
			move.baseX = position?.x ?? (rect ? Math.max(0, rect.left) : 0);
			move.baseY = position?.y ?? (rect ? Math.max(0, rect.top) : 0);
		}
		setPosition(clampPositionToViewport({ x: move.baseX + deltaX, y: move.baseY + deltaY }));
	}, [position]);

	const handleMovePointerUp = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
		const move = moveStateRef.current;
		moveStateRef.current = null;
		if (!move || move.pointerId !== event.pointerId || !move.moved) return;
		const finalPosition = latestPositionRef.current;
		if (finalPosition) {
			saveAppSetting(POSITION_SETTING_KEY, finalPosition);
		}
	}, []);

	return (
		<div
			className={`${styles.prompterPanel} launch-theme ${styles.electronNoDrag}`}
			data-hud-interactive
			data-testid="teleprompter-prompter"
			style={
				position
					? { left: `${position.x}px`, top: `${position.y}px`, right: "auto", transform: "none" }
					: undefined
			}
		>
			<div
				className={styles.prompterHeader}
				style={{ cursor: "grab", touchAction: "none" }}
				onPointerDown={handleMovePointerDown}
				onPointerMove={handleMovePointerMove}
				onPointerUp={handleMovePointerUp}
				onPointerCancel={handleMovePointerUp}
				title={t("recording.prompterMove")}
			>
				<span className={styles.prompterTitle}>{t("recording.teleprompter")}</span>
				<span
					className={`${styles.prompterStateBadge} ${autoScrollActive ? styles.prompterStatePlaying : ""}`}
				>
					{prompterStateLabel}
				</span>
				<button
					type="button"
					className={styles.prompterIconButton}
					onClick={userPaused || atEnd ? resumeAutoScroll : pauseAutoScroll}
					title={
						userPaused || atEnd
							? t("recording.prompterResume")
							: t("recording.prompterPause")
					}
					aria-label={
						userPaused || atEnd
							? t("recording.prompterResume")
							: t("recording.prompterPause")
					}
				>
					{userPaused || atEnd ? <CaretUpIcon size={14} /> : <CaretDownIcon size={14} />}
				</button>
				<button
					type="button"
					className={styles.prompterIconButton}
					onClick={onClose}
					title={t("recording.hideHud")}
					aria-label={t("recording.hideHud")}
				>
					<XIcon size={14} />
				</button>
			</div>
			<div
				ref={scrollRef}
				className={styles.prompterScrollArea}
				style={{ fontSize: `${fontSize}px` }}
				onPointerDown={handlePointerDown}
				onPointerMove={handlePointerMove}
				onPointerUp={handlePointerUp}
				onPointerCancel={handlePointerUp}
			>
				{notes.trim().length > 0 ? (
					notes
				) : (
					<span className={styles.prompterEmpty}>{t("recording.notesPlaceholder")}</span>
				)}
			</div>
		</div>
	);
}
