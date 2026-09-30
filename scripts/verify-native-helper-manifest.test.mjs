import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { updateNativeHelperManifest } from "./native-helper-manifest.mjs";
import {
	KNOWN_STALE_HELPERS,
	summarizeProvenance,
	verifyAllHelpers,
} from "./verify-native-helper-manifest.mjs";

const ARCH_TAG = "win32-x64";

function seedHelper(root, helperId, { binaryName, sources }) {
	const sourceDir = path.join(root, "electron", "native", helperId);
	const binDir = path.join(root, "electron", "native", "bin", ARCH_TAG);
	mkdirSync(sourceDir, { recursive: true });
	mkdirSync(binDir, { recursive: true });

	for (const [relativePath, content] of Object.entries(sources)) {
		const target = path.join(sourceDir, relativePath);
		mkdirSync(path.dirname(target), { recursive: true });
		writeFileSync(target, content);
	}

	const binaryPath = path.join(binDir, binaryName);
	writeFileSync(binaryPath, `fake-binary-${helperId}`);

	updateNativeHelperManifest({
		projectRoot: root,
		helperId,
		sourceDir,
		binaryPath,
		binaryName,
		platform: "win32",
		arch: "x64",
	});

	return { sourceDir, binaryPath };
}

describe("verifyAllHelpers", () => {
	let root;
	beforeEach(() => {
		root = mkdtempSync(path.join(os.tmpdir(), "morec-provenance-"));
	});
	afterEach(() => {
		rmSync(root, { recursive: true, force: true });
	});

	it("passes on an untouched tree", () => {
		seedHelper(root, "cursor-monitor", {
			binaryName: "cursor-monitor.exe",
			sources: { "CMakeLists.txt": "cmake_minimum_required(VERSION 3.10)\n" },
		});
		const { results } = verifyAllHelpers({ projectRoot: root, archTag: ARCH_TAG });
		expect(results).toHaveLength(1);
		expect(results[0].ok).toBe(true);
		expect(summarizeProvenance(results).ok).toBe(true);
	});

	// REGRESSION: the real wgc-capture case -- a source that moved after the
	// binary was committed. The binary is untouched, so only the source
	// fingerprint may be reported.
	it("detects a source that moved past the committed binary", () => {
		const { sourceDir } = seedHelper(root, "gpu-export-probe", {
			binaryName: "morec-gpu-export.exe",
			sources: { "src/main.cpp": "int main(){return 0;}\n" },
		});
		writeFileSync(path.join(sourceDir, "src", "main.cpp"), "int main(){return 1;}\n");

		const { results } = verifyAllHelpers({ projectRoot: root, archTag: ARCH_TAG });
		expect(results[0].ok).toBe(false);
		expect(results[0].reasons).toContain("source fingerprint mismatch");
		expect(results[0].reasons).not.toContain("binary hash mismatch");
	});

	it("detects a swapped binary", () => {
		const { binaryPath } = seedHelper(root, "cursor-monitor", {
			binaryName: "cursor-monitor.exe",
			sources: { "src/main.cpp": "int main(){return 0;}\n" },
		});
		writeFileSync(binaryPath, "tampered");

		const { results } = verifyAllHelpers({ projectRoot: root, archTag: ARCH_TAG });
		expect(results[0].ok).toBe(false);
		expect(results[0].reasons).toContain("binary hash mismatch");
	});

	it("returns an empty result set when there is no manifest", () => {
		const { results, manifestPath } = verifyAllHelpers({
			projectRoot: root,
			archTag: ARCH_TAG,
		});
		expect(results).toEqual([]);
		expect(manifestPath.endsWith("helpers-manifest.json")).toBe(true);
	});
});

describe("summarizeProvenance", () => {
	const stale = (helperId) => ({
		helperId,
		ok: false,
		reasons: ["source fingerprint mismatch"],
		allowlistedStale: true,
	});
	const broken = (helperId) => ({
		helperId,
		ok: false,
		reasons: ["source fingerprint mismatch"],
		allowlistedStale: false,
	});

	it("does not fail the run for an allowlisted-stale helper", () => {
		const summary = summarizeProvenance([stale("wgc-capture")]);
		expect(summary.ok).toBe(true);
		expect(summary.stale.map((entry) => entry.helperId)).toEqual(["wgc-capture"]);
	});

	it("fails the run for a helper that is not allowlisted", () => {
		const summary = summarizeProvenance([broken("cursor-monitor")]);
		expect(summary.ok).toBe(false);
		expect(summary.failures.map((entry) => entry.helperId)).toEqual(["cursor-monitor"]);
	});

	it("allowlists exactly the known-stale wgc-capture helper", () => {
		expect([...KNOWN_STALE_HELPERS]).toEqual(["wgc-capture"]);
	});
});
