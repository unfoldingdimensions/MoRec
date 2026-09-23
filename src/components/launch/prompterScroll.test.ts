import { describe, expect, it } from "vitest";
import {
	advancePrompterOffset,
	clampPrompterOffset,
	createPrompterScrollAnchor,
	normalizeTeleprompterFontSize,
	normalizeTeleprompterNotes,
	normalizeTeleprompterScrollSpeed,
} from "./prompterScroll";

describe("prompter scroll math", () => {
	it("advances linearly with elapsed time at the configured speed", () => {
		const anchor = createPrompterScrollAnchor(10, 1000);
		// 40 px/s for 2 seconds → +80 px from the 10 px anchor.
		expect(advancePrompterOffset(anchor, 3000, 40)).toBeCloseTo(90);
	});

	it("uses the full position formula position = f(elapsed, speed)", () => {
		const anchor = createPrompterScrollAnchor(0, 0);
		expect(advancePrompterOffset(anchor, 0, 40)).toBe(0);
		expect(advancePrompterOffset(anchor, 500, 40)).toBeCloseTo(20);
		expect(advancePrompterOffset(anchor, 1000, 160)).toBe(160);
		// Zero speed holds position regardless of elapsed time.
		expect(advancePrompterOffset(anchor, 60000, 0)).toBe(0);
	});

	it("never moves backwards when the elapsed clock jitters", () => {
		const anchor = createPrompterScrollAnchor(50, 5000);
		expect(advancePrompterOffset(anchor, 4000, 40)).toBe(50);
		expect(advancePrompterOffset(anchor, 5000, 40)).toBe(50);
		expect(advancePrompterOffset(anchor, 5001, 40)).toBeCloseTo(50.04);
	});

	it("clamps offsets into [0, maxOffset]", () => {
		expect(clampPrompterOffset(-5, 100)).toBe(0);
		expect(clampPrompterOffset(50, 100)).toBe(50);
		expect(clampPrompterOffset(150, 100)).toBe(100);
		// A scrolled-to-end container (max 0) pins to the top.
		expect(clampPrompterOffset(150, 0)).toBe(0);
		expect(clampPrompterOffset(150, Number.NaN)).toBe(0);
	});

	it("anchors normalize negative inputs to zero", () => {
		const anchor = createPrompterScrollAnchor(-10, -5);
		expect(anchor).toEqual({ offsetPx: 0, elapsedMs: 0 });
	});
});

describe("teleprompter setting normalizers", () => {
	it("keeps valid persisted values", () => {
		expect(normalizeTeleprompterNotes("line one\nline two")).toBe("line one\nline two");
		expect(normalizeTeleprompterFontSize(28)).toBe(28);
		expect(normalizeTeleprompterScrollSpeed(80)).toBe(80);
	});

	it("falls back to defaults for missing or wrong-typed values", () => {
		expect(normalizeTeleprompterNotes(null)).toBe("");
		expect(normalizeTeleprompterNotes(42)).toBe("");
		expect(normalizeTeleprompterFontSize(undefined)).toBe(20);
		expect(normalizeTeleprompterFontSize("28")).toBe(20);
		expect(normalizeTeleprompterFontSize(Number.NaN)).toBe(20);
		expect(normalizeTeleprompterScrollSpeed(null)).toBe(40);
	});

	it("clamps out-of-range persisted values instead of rejecting them", () => {
		expect(normalizeTeleprompterFontSize(4)).toBe(10);
		expect(normalizeTeleprompterFontSize(500)).toBe(72);
		expect(normalizeTeleprompterScrollSpeed(-10)).toBe(0);
		expect(normalizeTeleprompterScrollSpeed(9999)).toBe(400);
		// Fractional persisted sizes round to whole pixels.
		expect(normalizeTeleprompterFontSize(24.6)).toBe(25);
	});
});
