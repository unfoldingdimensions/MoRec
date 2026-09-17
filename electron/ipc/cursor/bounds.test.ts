import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
	app: {
		getPath: vi.fn(() => "/tmp"),
	},
}));

import { buildWindowsWindowBoundsCommand, escapePowerShellSingleQuoted } from "./bounds";

describe("buildWindowsWindowBoundsCommand", () => {
	it("appends the window id and title as bound script-block arguments", () => {
		const command = buildWindowsWindowBoundsCommand(12345, "Untitled - Notepad");

		expect(command).toContain("param([string]$windowId, [string]$windowTitle)");
		// Args must share the closing-brace line or PowerShell parses them as
		// separate statements instead of script-block arguments.
		expect(command.trimEnd().endsWith("} '12345' 'Untitled - Notepad'")).toBe(true);
	});

	it("keeps the whole lookup in a single script block so -Command binds the args", () => {
		const command = buildWindowsWindowBoundsCommand(42, "Doc");

		expect(command.startsWith("& {")).toBe(true);
		expect(command.trimEnd().endsWith("}")).toBe(false);
	});

	it("doubles embedded single quotes in the window title", () => {
		const command = buildWindowsWindowBoundsCommand(null, "Bob's Window");

		expect(command.trimEnd().endsWith("'' 'Bob''s Window'")).toBe(true);
	});

	it("passes an empty quoted id when only the title is known", () => {
		const command = buildWindowsWindowBoundsCommand(null, "Some App");

		expect(command.trimEnd().endsWith("'' 'Some App'")).toBe(true);
	});

	it("requests per-monitor-v2 DPI awareness before GetWindowRect", () => {
		const command = buildWindowsWindowBoundsCommand(1, "x");

		const awarenessIndex = command.indexOf("SetProcessDpiAwarenessContext([IntPtr](-4))");
		const rectIndex = command.indexOf("GetWindowRect([IntPtr]$handle");
		expect(awarenessIndex).toBeGreaterThan(-1);
		expect(rectIndex).toBeGreaterThan(awarenessIndex);
	});
});

describe("escapePowerShellSingleQuoted", () => {
	it("doubles single quotes and leaves other characters untouched", () => {
		expect(escapePowerShellSingleQuoted("it's a 'test'")).toBe("it''s a ''test''");
		expect(escapePowerShellSingleQuoted("plain")).toBe("plain");
	});
});
