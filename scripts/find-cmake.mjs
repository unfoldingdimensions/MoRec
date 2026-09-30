import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

import { WINDOWS_VISUAL_STUDIO_INSTALL_DIRS } from "./windows-cmake-generators.mjs";

// Union of every edition the four original copies probed. "Preview" appeared
// only in the NVIDIA compositor's copy, so dropping it here would regress
// anyone building against a Visual Studio preview.
const VS_EDITIONS = Object.freeze([
	"Preview",
	"Community",
	"Professional",
	"Enterprise",
	"BuildTools",
]);
const WINDOWS_PROGRAM_FILES_ROOTS = Object.freeze([
	path.join("C:\\", "Program Files"),
	path.join("C:\\", "Program Files (x86)"),
]);

/**
 * Every location probed for CMake on Windows, in priority order:
 *
 *  1. standalone CMake installers (Program Files, then Program Files (x86))
 *  2. CMake bundled with each Visual Studio install/edition
 *
 * Exported so tests can assert search order without hard-coding separators
 * (which differ on a Linux CI runner).
 */
export function getWindowsCmakeCandidates() {
	const candidates = WINDOWS_PROGRAM_FILES_ROOTS.map((root) =>
		path.join(root, "CMake", "bin", "cmake.exe"),
	);

	for (const root of WINDOWS_PROGRAM_FILES_ROOTS) {
		for (const version of WINDOWS_VISUAL_STUDIO_INSTALL_DIRS) {
			for (const edition of VS_EDITIONS) {
				candidates.push(
					path.join(
						root,
						"Microsoft Visual Studio",
						version,
						edition,
						"Common7",
						"IDE",
						"CommonExtensions",
						"Microsoft",
						"CMake",
						"CMake",
						"bin",
						"cmake.exe",
					),
				);
			}
		}
	}

	return candidates;
}

/**
 * Locate CMake.
 *
 * Returns a RAW path, or the bare command "cmake" when it is on PATH, or null.
 * Callers that interpolate the result into a shell string must wrap it in
 * quoteForShell(); callers using execFileSync/execFileSync-style array args
 * must NOT, or the quotes become part of the filename.
 *
 * This is the single implementation for every build script. Whisper's build
 * previously carried its own copy that omitted the standalone-install
 * locations, so a machine with CMake installed still reported "CMake is
 * required".
 *
 * @param {{ platform?: NodeJS.Platform, exec?: (command: string) => void, exists?: (candidate: string) => boolean }} [options]
 * @returns {string | null}
 */
export function findCmake({ platform = process.platform, exec, exists = existsSync } = {}) {
	const probe =
		exec ??
		((command) => {
			execSync(command, { stdio: "pipe" });
		});

	try {
		probe("cmake --version");
		return "cmake";
	} catch {
		// Not on PATH; fall through to the platform-specific locations.
	}

	if (platform !== "win32") {
		return null;
	}

	for (const candidate of getWindowsCmakeCandidates()) {
		if (exists(candidate)) {
			return candidate;
		}
	}

	return null;
}

/**
 * Quote a findCmake() result for interpolation into an execSync() string.
 * The bare command is left unquoted so `cmake --build .` keeps working.
 *
 * @param {string} cmakePath
 * @returns {string}
 */
export function quoteForShell(cmakePath) {
	return cmakePath === "cmake" ? cmakePath : `"${cmakePath}"`;
}
