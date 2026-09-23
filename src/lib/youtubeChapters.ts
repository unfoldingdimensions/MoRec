/**
 * YouTube chapter text helpers: chapters render as `m:ss Title` lines
 * starting at 0:00, and an editable modal round-trips them through the same
 * text format.
 */

export interface ChapterMarker {
	startMs: number;
	title: string;
}

function formatClock(ms: number): string {
	const totalSeconds = Math.max(0, Math.floor(ms / 1000));
	const hours = Math.floor(totalSeconds / 3600);
	const minutes = Math.floor((totalSeconds % 3600) / 60);
	const seconds = totalSeconds % 60;
	if (hours > 0) {
		return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
	}
	return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function parseClock(value: string): number | null {
	const trimmed = value.trim();
	const hmsMatch = trimmed.match(/^(?:(\d+):)?(\d{1,2}):(\d{1,2})$/);
	if (hmsMatch) {
		const hours = hmsMatch[1] ? Number.parseInt(hmsMatch[1], 10) : 0;
		const minutes = Number.parseInt(hmsMatch[2], 10);
		const seconds = Number.parseInt(hmsMatch[3], 10);
		return (hours * 3600 + minutes * 60 + seconds) * 1000;
	}
	const msMatch = trimmed.match(/^(\d+):(\d{1,2})$/);
	if (msMatch) {
		return (Number.parseInt(msMatch[1], 10) * 60 + Number.parseInt(msMatch[2], 10)) * 1000;
	}
	return null;
}

/** Render chapters as YouTube-style `m:ss Title` lines, first at 0:00. */
export function formatChaptersText(chapters: ChapterMarker[]): string {
	if (chapters.length === 0) {
		return "";
	}
	const withLeadingZero: ChapterMarker[] =
		chapters[0].startMs === 0 ? chapters : [{ startMs: 0, title: "" }, ...chapters];
	return withLeadingZero
		.map((chapter) => {
			const title = chapter.title.trim();
			return title ? `${formatClock(chapter.startMs)} ${title}` : formatClock(chapter.startMs);
		})
		.join("\n");
}

/**
 * Parse edited `m:ss Title` (or `h:mm:ss Title`) lines back into chapters.
 * Unparseable times and empty titles are dropped; timestamps are clamped to
 * be non-negative and sorted.
 */
export function parseChaptersText(text: string): ChapterMarker[] {
	const chapters: ChapterMarker[] = [];
	for (const line of text.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (!trimmed) {
			continue;
		}
		const match = trimmed.match(/^(\d{1,2}(?::\d{1,2}){1,2})\s+(.*)$/);
		if (!match) {
			continue;
		}
		const startMs = parseClock(match[1]);
		const title = match[2].trim();
		if (startMs === null || !title) {
			continue;
		}
		chapters.push({ startMs, title });
	}
	chapters.sort((left, right) => left.startMs - right.startMs);
	return chapters;
}
