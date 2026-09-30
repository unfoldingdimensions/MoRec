import { describe, expect, it } from "vitest";
import { WINDOWS_SYSTEM_TAR, resolveTarCommand } from "./tar-command.mjs";

describe("resolveTarCommand", () => {
	it("prefers Windows' bundled bsdtar on win32", () => {
		const result = resolveTarCommand({
			platform: "win32",
			fileExists: (candidate) => candidate === WINDOWS_SYSTEM_TAR,
		});
		expect(result).toBe(WINDOWS_SYSTEM_TAR);
	});

	it("falls back to PATH tar when System32 has no tar", () => {
		expect(resolveTarCommand({ platform: "win32", fileExists: () => false })).toBe("tar");
	});

	it("never prefers a Windows path off win32", () => {
		for (const platform of ["linux", "darwin"]) {
			expect(resolveTarCommand({ platform, fileExists: () => true })).toBe("tar");
		}
	});

	it("targets a native Windows path, not an MSYS one", () => {
		// The whole point: MSYS/GNU tar reads "D:\..." as an rsh host and fails
		// with "Cannot connect to D". Windows' own bsdtar handles it. Built
		// escape-free (and without path.join, which would mangle the separators
		// on the Linux CI runner) so the expectation is platform-independent.
		const backslash = String.fromCharCode(92);
		expect(WINDOWS_SYSTEM_TAR).toBe(["C:", "Windows", "System32", "tar.exe"].join(backslash));
		expect(WINDOWS_SYSTEM_TAR.startsWith(`C:${backslash}Windows`)).toBe(true);
		expect(WINDOWS_SYSTEM_TAR.endsWith("tar.exe")).toBe(true);
		expect(WINDOWS_SYSTEM_TAR.includes("/")).toBe(false);
	});
});
