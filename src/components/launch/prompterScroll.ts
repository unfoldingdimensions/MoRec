/**
 * Pure scroll math for the recording teleprompter, plus the app-settings keys
 * and normalizers shared by the Notes editor popover and the prompter panel.
 */

export const TELEPROMPTER_NOTES_KEY = "teleprompterNotes";
export const TELEPROMPTER_FONT_SIZE_KEY = "teleprompterFontSize";
export const TELEPROMPTER_SCROLL_SPEED_KEY = "teleprompterScrollSpeed";

export const DEFAULT_TELEPROMPTER_NOTES = "";
export const DEFAULT_TELEPROMPTER_FONT_SIZE = 20;
/** Pixels per second at speed multiplier 1×. */
export const PROMPTER_BASE_SPEED_PX_PER_SEC = 40;
export const DEFAULT_TELEPROMPTER_SCROLL_SPEED = PROMPTER_BASE_SPEED_PX_PER_SEC;

export const TELEPROMPTER_FONT_SIZE_OPTIONS = [14, 16, 18, 20, 24, 28, 32, 40, 48];
/** Speed options in px/s, shown in the UI as multipliers of the base speed. */
export const TELEPROMPTER_SPEED_OPTIONS = [20, 40, 80, 160];

export function normalizeTeleprompterNotes(value: unknown): string {
	return typeof value === "string" ? value : DEFAULT_TELEPROMPTER_NOTES;
}

export function normalizeTeleprompterFontSize(value: unknown): number {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		return DEFAULT_TELEPROMPTER_FONT_SIZE;
	}
	return Math.min(72, Math.max(10, Math.round(value)));
}

export function normalizeTeleprompterScrollSpeed(value: unknown): number {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		return DEFAULT_TELEPROMPTER_SCROLL_SPEED;
	}
	return Math.min(400, Math.max(0, value));
}

/** Where the prompter was when auto-scroll last (re)started. */
export interface PrompterScrollAnchor {
	offsetPx: number;
	elapsedMs: number;
}

export function createPrompterScrollAnchor(offsetPx = 0, elapsedMs = 0): PrompterScrollAnchor {
	return { offsetPx: Math.max(0, offsetPx), elapsedMs: Math.max(0, elapsedMs) };
}

/**
 * Auto-scroll position: linear in elapsed time, never moves backwards even if
 * the elapsed clock jitters. Position = f(elapsed, speed).
 */
export function advancePrompterOffset(
	anchor: PrompterScrollAnchor,
	elapsedMs: number,
	speedPxPerSec: number,
): number {
	const deltaMs = Math.max(0, elapsedMs - anchor.elapsedMs);
	const speed = Math.max(0, speedPxPerSec);
	return anchor.offsetPx + (deltaMs / 1000) * speed;
}

/** Clamp a scroll offset into [0, maxOffset]; an unusable max clamps to 0. */
export function clampPrompterOffset(offsetPx: number, maxOffsetPx: number): number {
	const max = Number.isFinite(maxOffsetPx) ? Math.max(0, maxOffsetPx) : 0;
	return Math.min(max, Math.max(0, offsetPx));
}
