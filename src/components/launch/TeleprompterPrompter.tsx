import { CaretDownIcon, CaretUpIcon, XIcon } from "@phosphor-icons/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useScopedT } from "@/contexts/I18nContext";
import {
	advancePrompterOffset,
	clampPrompterOffset,
	createPrompterScrollAnchor,
} from "./prompterScroll";
import styles from "./LaunchWindow.module.css";

const DRAG_THRESHOLD_PX = 5;

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

	return (
		<div
			className={`${styles.prompterPanel} launch-theme ${styles.electronNoDrag}`}
			data-hud-interactive
			data-testid="teleprompter-prompter"
		>
			<div className={styles.prompterHeader}>
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
