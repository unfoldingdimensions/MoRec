import { beforeEach, describe, expect, it } from "vitest";
import {
	hideCursor,
	isCursorHidden,
	resetCursorHiderState,
	showCursor,
} from "./cursorHider";

describe("cursorHider", () => {
	beforeEach(() => {
		resetCursorHiderState();
	});

	it("initially reports cursor as visible", () => {
		expect(isCursorHidden()).toBe(false);
	});

	it("hides cursor successfully without blocking subprocesses", () => {
		expect(hideCursor()).toBe(true);
		expect(isCursorHidden()).toBe(true);
	});

	it("returns false if cursor is already hidden", () => {
		expect(hideCursor()).toBe(true);
		expect(hideCursor()).toBe(false);
		expect(isCursorHidden()).toBe(true);
	});

	it("shows cursor successfully after being hidden", () => {
		hideCursor();
		expect(showCursor()).toBe(true);
		expect(isCursorHidden()).toBe(false);
	});

	it("returns false if cursor is already visible", () => {
		expect(showCursor()).toBe(false);
		expect(isCursorHidden()).toBe(false);
	});

	it("resets state reliably", () => {
		hideCursor();
		expect(isCursorHidden()).toBe(true);
		resetCursorHiderState();
		expect(isCursorHidden()).toBe(false);
	});
});

