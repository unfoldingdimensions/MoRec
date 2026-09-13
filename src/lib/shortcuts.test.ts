import { describe, expect, it } from "vitest";

import {
	bindingsEqual,
	DEFAULT_SHORTCUTS,
	findConflict,
	type ShortcutBinding,
} from "./shortcuts";

const binding = (key: string, mods: Partial<ShortcutBinding> = {}): ShortcutBinding => ({
	key,
	...mods,
});

describe("bindingsEqual", () => {
	it("compares key and modifiers case-insensitively", () => {
		expect(bindingsEqual({ key: "K" }, { key: "k" })).toBe(true);
		expect(bindingsEqual({ key: "k", ctrl: true }, { key: "k", ctrl: true })).toBe(true);
		expect(bindingsEqual({ key: "k" }, { key: "k", ctrl: true })).toBe(false);
	});
});

describe("findConflict", () => {
	it("rejects chords hardcoded for undo, redo, and select-all as reserved", () => {
		const conflictFor = (b: ShortcutBinding) => findConflict(b, "addZoom", DEFAULT_SHORTCUTS);

		expect(conflictFor(binding("z", { ctrl: true })).type).toBe("fixed");
		expect(conflictFor(binding("z", { ctrl: true, shift: true })).type).toBe("fixed");
	});

	it("identifies redo and select-all as the conflicting fixed shortcut", () => {
		const redoConflict = findConflict(binding("y", { ctrl: true }), "splitClip", DEFAULT_SHORTCUTS);
		const selectAllConflict = findConflict(
			binding("a", { ctrl: true }),
			"splitClip",
			DEFAULT_SHORTCUTS,
		);

		expect(redoConflict).toMatchObject({ type: "fixed", id: "redo" });
		expect(selectAllConflict).toMatchObject({ type: "fixed", id: "selectAllZooms" });
	});

	it("still detects configurable conflicts between actions", () => {
		const config = {
			...DEFAULT_SHORTCUTS,
			addZoom: binding("k", { alt: true }),
		};
		expect(findConflict(binding("k", { alt: true }), "splitClip", config)).toEqual({
			type: "configurable",
			action: "addZoom",
		});
	});

	it("does not report a conflict when rebinding an action to its own chord", () => {
		expect(findConflict(DEFAULT_SHORTCUTS.addZoom, "addZoom", DEFAULT_SHORTCUTS)).toBeNull();
	});
});
