import { describe, expect, it } from "vitest";

import {
	bindingsEqual,
	DEFAULT_SHORTCUTS,
	findConflict,
	matchesShortcut,
	type ShortcutBinding,
} from "./shortcuts";

const keyEvent = (init: {
	key: string;
	ctrlKey?: boolean;
	metaKey?: boolean;
	shiftKey?: boolean;
	altKey?: boolean;
}): KeyboardEvent =>
	({
		key: init.key,
		ctrlKey: init.ctrlKey ?? false,
		metaKey: init.metaKey ?? false,
		shiftKey: init.shiftKey ?? false,
		altKey: init.altKey ?? false,
	}) as KeyboardEvent;

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

describe("matchesShortcut", () => {
	it("fires a primary-modifier binding on either physical ctrl or cmd", () => {
		const binding: ShortcutBinding = { key: "k", ctrl: true };
		expect(matchesShortcut(keyEvent({ key: "k", ctrlKey: true }), binding)).toBe(true);
		expect(matchesShortcut(keyEvent({ key: "k", metaKey: true }), binding)).toBe(true);
		expect(matchesShortcut(keyEvent({ key: "k" }), binding)).toBe(false);
	});

	it("requires no modifier for unmodified bindings", () => {
		const binding: ShortcutBinding = { key: "z" };
		expect(matchesShortcut(keyEvent({ key: "z" }), binding)).toBe(true);
		expect(matchesShortcut(keyEvent({ key: "z", ctrlKey: true }), binding)).toBe(false);
		expect(matchesShortcut(keyEvent({ key: "z", metaKey: true }), binding)).toBe(false);
	});

	it("still matches shift and alt exactly", () => {
		const binding: ShortcutBinding = { key: "k", ctrl: true, shift: true };
		expect(
			matchesShortcut(keyEvent({ key: "k", metaKey: true, shiftKey: true }), binding),
		).toBe(true);
		expect(matchesShortcut(keyEvent({ key: "k", ctrlKey: true }), binding)).toBe(false);
		expect(
			matchesShortcut(keyEvent({ key: "k", ctrlKey: true, altKey: true, shiftKey: true }), {
				key: "k",
				ctrl: true,
				shift: true,
			}),
		).toBe(false);
	});
});
