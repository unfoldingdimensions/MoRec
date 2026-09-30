import { describe, expect, it } from "vitest";
import { findCmake, getWindowsCmakeCandidates, quoteForShell } from "./find-cmake.mjs";

function deps({ onPath = false, existing = [] } = {}) {
	return {
		platform: "win32",
		exec: () => {
			if (!onPath) {
				throw new Error("cmake: not found");
			}
		},
		exists: (candidate) => existing.includes(candidate),
	};
}

// Candidates are built by the module itself so these assertions hold on Linux
// CI (where path.join uses "/") as well as on a Windows developer machine.
const candidates = getWindowsCmakeCandidates();
// Naming must be exact: Visual Studio's bundled path also contains "CMake"
// (…/CommonExtensions/Microsoft/CMake/CMake/bin/cmake.exe), so filter on the
// Visual Studio root instead.
const vsBundled = candidates.filter((entry) => entry.includes("Microsoft Visual Studio"));
const standalone = candidates.filter((entry) => !entry.includes("Microsoft Visual Studio"));

describe("getWindowsCmakeCandidates", () => {
	it("searches standalone installs before Visual Studio's bundled copy", () => {
		expect(standalone.length).toBeGreaterThan(0);
		expect(vsBundled.length).toBeGreaterThan(0);
		expect(candidates.indexOf(standalone[0])).toBeLessThan(candidates.indexOf(vsBundled[0]));
	});

	it("covers every Visual Studio install directory and edition", () => {
		for (const version of ["18", "2022", "2019"]) {
			expect(vsBundled.some((entry) => entry.includes(version))).toBe(true);
		}
		// "Preview" is included because the NVIDIA compositor's copy probed it
		// and the shared implementation must not regress that.
		for (const edition of [
			"Preview",
			"Community",
			"Professional",
			"Enterprise",
			"BuildTools",
		]) {
			expect(vsBundled.some((entry) => entry.includes(edition))).toBe(true);
		}
	});
});

describe("findCmake", () => {
	it("prefers PATH and returns the bare command so execFileSync stays quoted-free", () => {
		expect(findCmake(deps({ onPath: true, existing: [standalone[0]] }))).toBe("cmake");
	});

	// REGRESSION: this is the case whisper's own copy missed, which made it
	// report "CMake is required" on a machine with CMake installed.
	it("finds a standalone CMake when PATH misses it", () => {
		expect(findCmake(deps({ existing: [standalone[0]] }))).toBe(standalone[0]);
	});

	it("finds every standalone location, not just the first", () => {
		for (const candidate of standalone) {
			expect(findCmake(deps({ existing: [candidate] }))).toBe(candidate);
		}
	});

	it("falls back to Visual Studio's bundled CMake", () => {
		const candidate = vsBundled[0];
		expect(findCmake(deps({ existing: [candidate] }))).toBe(candidate);
	});

	it("returns null when nothing is found", () => {
		expect(findCmake(deps())).toBeNull();
	});

	it("does not probe Windows-only locations on other platforms", () => {
		// exec must throw to mean "not on PATH"; otherwise the PATH hit wins and
		// the platform branch is never reached.
		const notOnPath = {
			exec: () => {
				throw new Error("cmake: not found");
			},
			exists: () => true,
		};
		expect(findCmake({ platform: "linux", ...notOnPath })).toBeNull();
		expect(findCmake({ platform: "darwin", ...notOnPath })).toBeNull();
	});

	it("returns a raw path, never a shell-quoted one", () => {
		const found = findCmake(deps({ existing: [standalone[0]] }));
		expect(found.startsWith('"')).toBe(false);
	});
});

describe("quoteForShell", () => {
	it("wraps a path so a shell interpolation survives spaces", () => {
		expect(quoteForShell(standalone[0])).toBe(`"${standalone[0]}"`);
	});

	it("leaves the bare command alone", () => {
		expect(quoteForShell("cmake")).toBe("cmake");
	});

	it("produces something safe to interpolate into an execSync string", () => {
		const quoted = quoteForShell(standalone[0]);
		expect(quoted.includes("Program Files")).toBe(true);
		expect(quoted.startsWith('"') && quoted.endsWith('"')).toBe(true);
	});
});
