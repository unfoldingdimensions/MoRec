import { execSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";

import { findCmake, quoteForShell } from "./find-cmake.mjs";
import {
	formatNativeHelperManifestWarning,
	updateNativeHelperManifest,
	verifyNativeHelperManifest,
} from "./native-helper-manifest.mjs";
import { configureWithWindowsCmakeGenerator } from "./windows-cmake-generators.mjs";

/**
 * Shared configure/build/stage pipeline for the Windows CMake-based native
 * helpers (wgc-capture, cursor-monitor). Returns:
 *   "built"        — fresh binary built and staged, manifest updated
 *   "used-bundled" — no usable CMake; kept the bundled binary after manifest check
 *   "failed"       — CMake exists but configure/build failed and no bundled fallback
 */
export function buildWindowsCmakeHelper({
	prefix,
	helperId,
	sourceDir,
	binaryName,
	generatorArch,
	projectRoot = process.cwd(),
	log = console.log,
	error = console.error,
}) {
	const buildDir = path.join(sourceDir, "build");
	const bundledDir = path.join(
		projectRoot,
		"electron",
		"native",
		"bin",
		process.arch === "arm64" ? "win32-arm64" : "win32-x64",
	);
	const bundledExePath = path.join(bundledDir, binaryName);

	if (process.platform !== "win32") {
		log(`[${prefix}] Skipping native Windows helper build: host platform is not Windows.`);
		return "used-bundled";
	}

	if (!existsSync(path.join(sourceDir, "CMakeLists.txt"))) {
		error(`[${prefix}] CMakeLists.txt not found at`, sourceDir);
		return "failed";
	}

	const cmake = findCmake();
	if (!cmake) {
		if (existsSync(bundledExePath)) {
			const verification = verifyNativeHelperManifest({
				projectRoot,
				helperId,
				sourceDir,
				binaryPath: bundledExePath,
				binaryName,
			});
			if (!verification.ok) {
				log(formatNativeHelperManifestWarning(prefix, verification));
			}
			log(`[${prefix}] Using bundled helper: ${bundledExePath}`);
			return "used-bundled";
		}

		error(
			`[${prefix}] CMake not found. Install Visual Studio with C++ CMake tools or standalone CMake.`,
		);
		return "failed";
	}

	mkdirSync(buildDir, { recursive: true });
	const cacheFile = path.join(buildDir, "CMakeCache.txt");
	const cacheDir = path.join(buildDir, "CMakeFiles");

	function clearCmakeCache() {
		rmSync(cacheFile, { force: true });
		rmSync(cacheDir, { recursive: true, force: true });
	}

	log(`[${prefix}] Configuring CMake...`);
	try {
		configureWithWindowsCmakeGenerator({
			prefix,
			clearCache: clearCmakeCache,
			configure: (generator, toolset) =>
				execSync(
					`${quoteForShell(cmake)} .. -G "${generator}" -A ${generatorArch}${toolset ? ` -T ${toolset}` : ""}`,
					{
						cwd: buildDir,
						stdio: "inherit",
						timeout: 120000,
					},
				),
		});
	} catch (configureError) {
		if (existsSync(bundledExePath)) {
			log(`[${prefix}] Build tools not configured; using bundled helper: ${bundledExePath}`);
			return "used-bundled";
		}
		error(`[${prefix}] CMake configure failed:`, configureError.message);
		return "failed";
	}

	log(`[${prefix}] Building native helper...`);
	try {
		execSync(`${quoteForShell(cmake)} --build . --config Release`, {
			cwd: buildDir,
			stdio: "inherit",
			timeout: 300000,
		});
	} catch (buildError) {
		error(`[${prefix}] Build failed:`, buildError.message);
		return "failed";
	}

	const exePath = path.join(buildDir, "Release", binaryName);
	if (!existsSync(exePath)) {
		error(`[${prefix}] Expected exe not found at`, exePath);
		return "failed";
	}

	mkdirSync(bundledDir, { recursive: true });
	copyFileSync(exePath, bundledExePath);
	log(`[${prefix}] Staged bundled helper: ${bundledExePath}`);
	const manifestPath = updateNativeHelperManifest({
		projectRoot,
		helperId,
		sourceDir,
		binaryPath: bundledExePath,
		binaryName,
	});
	log(`[${prefix}] Updated helper manifest: ${manifestPath}`);
	return "built";
}
