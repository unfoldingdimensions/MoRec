import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
	getNativeHelperManifestPath,
	verifyNativeHelperManifest,
} from "./native-helper-manifest.mjs";

/**
 * Helpers whose committed binary is known to predate their sources and cannot
 * be rebuilt in CI (no MSVC/compiler toolchain on the runner).
 *
 * Every entry here is a shipping defect, not an accepted state: the gate
 * reports it on every run so it cannot be forgotten. Remove an entry by
 * rebuilding that helper and committing the fresh binary in the same change.
 *
 * wgc-capture: missing 4710733 ("finalize the take when the WGC capture item
 * closes mid-recording", C++ only -- no TypeScript half) and the native half of
 * 125532c ("mixed-DPI monitor selection"). Its sources advanced 2026-09-18 but
 * the committed binary is from e069621 (2026-08-19). electron/ipc/paths/binaries.ts
 * prefers the prebundled binary over a local build, so the stale copy is what
 * actually runs.
 */
export const KNOWN_STALE_HELPERS = new Set(["wgc-capture"]);

const DEFAULT_ARCH_TAG = "win32-x64";

function toManifestArch(archTag) {
	return archTag === "win32-arm64" ? "arm64" : "x64";
}

/**
 * Recompute every committed helper's provenance against the manifest.
 *
 * Compiler-free by design: it only hashes files, so it runs on any CI runner
 * (including the Linux quality job) and catches a stale or swapped bundled
 * binary without needing to build anything.
 *
 * @param {{ projectRoot?: string, archTag?: string }} [options]
 * @returns {{ manifestPath: string, results: Array<Record<string, unknown>> }}
 */
export function verifyAllHelpers({ projectRoot = process.cwd(), archTag = DEFAULT_ARCH_TAG } = {}) {
	const manifestPath = getNativeHelperManifestPath({
		projectRoot,
		platform: "win32",
		arch: toManifestArch(archTag),
	});

	if (!existsSync(manifestPath)) {
		return { manifestPath, results: [] };
	}

	const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
	const binDir = path.join(projectRoot, "electron", "native", "bin", archTag);
	const results = [];

	for (const [helperId, helperManifest] of Object.entries(manifest.helpers ?? {})) {
		const sourceDir = path.join(projectRoot, helperManifest.sourceDir);
		const binaryPath = path.join(binDir, helperManifest.binaryName);

		const verification = verifyNativeHelperManifest({
			projectRoot,
			helperId,
			sourceDir,
			binaryPath,
			binaryName: helperManifest.binaryName,
			platform: "win32",
			arch: toManifestArch(archTag),
		});

		results.push({
			helperId,
			binaryName: helperManifest.binaryName,
			sourceDir,
			binaryPath,
			...verification,
			allowlistedStale: KNOWN_STALE_HELPERS.has(helperId),
		});
	}

	return { manifestPath, results };
}

/**
 * Split results into hard failures and known-stale exceptions.
 * `ok` is false only for a helper that is failing and NOT allowlisted, so an
 * allowlisted entry stays visible without breaking unrelated PRs.
 *
 * @param {Array<Record<string, unknown>>} results
 */
export function summarizeProvenance(results) {
	return {
		failures: results.filter((entry) => !entry.ok && !entry.allowlistedStale),
		stale: results.filter((entry) => !entry.ok && entry.allowlistedStale),
		ok: results.every((entry) => entry.ok || entry.allowlistedStale),
	};
}

function formatStatus(entry) {
	if (entry.ok) {
		return "OK";
	}

	return entry.allowlistedStale ? "STALE (allowlisted)" : "FAIL";
}

function main() {
	const archTag = process.argv[2] ?? DEFAULT_ARCH_TAG;
	const { manifestPath, results } = verifyAllHelpers({ archTag });

	if (results.length === 0) {
		console.error(
			`[verify-native-helper-manifest] no helper entries found in ${path.relative(process.cwd(), manifestPath)}`,
		);
		process.exit(1);
	}

	console.log(`[verify-native-helper-manifest] ${archTag} (${results.length} helpers)`);
	for (const entry of results) {
		const detail = entry.ok ? "" : ` -- ${entry.reasons.join(", ")}`;
		console.log(`  ${formatStatus(entry).padEnd(20)} ${entry.helperId}${detail}`);
	}

	const summary = summarizeProvenance(results);

	if (summary.stale.length > 0) {
		console.warn(
			`[verify-native-helper-manifest] KNOWN STALE, needs a rebuild: ${summary.stale
				.map((entry) => entry.helperId)
				.join(", ")}. The committed binary does not match the committed sources; ` +
				"it will not pick up source fixes until it is rebuilt and recommitted.",
		);
	}

	if (!summary.ok) {
		console.error(
			`[verify-native-helper-manifest] failing helpers: ${summary.failures
				.map((entry) => `${entry.helperId} (${entry.reasons.join(", ")})`)
				.join("; ")}`,
		);
		process.exit(1);
	}

	console.log("[verify-native-helper-manifest] bundled helper provenance ok");
}

// Guarded so importing this module (e.g. from tests) never runs the CLI.
// import.meta.main is unavailable on the Node 22 used by CI.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	main();
}
