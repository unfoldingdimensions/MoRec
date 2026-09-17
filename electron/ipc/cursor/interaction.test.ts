import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
	app: {
		getPath: vi.fn(() => "/tmp"),
		setPath: vi.fn(),
		isReady: vi.fn(() => true),
	},
}));

import { isWithinDoubleClickDistance, repairBundledUiohookBinaryForCurrentArch } from "./interaction";

describe("isWithinDoubleClickDistance", () => {
	it("treats a 48-DIP gap as a double-click on a display-size region", () => {
		const region = { width: 2048, height: 1152 };
		// 0.02 of 2048 wide = ~41 DIP apart.
		expect(
			isWithinDoubleClickDistance({ cx: 0.1, cy: 0.5 }, { cx: 0.12, cy: 0.5 }, region),
		).toBe(true);
		// 0.05 of 2048 = 102 DIP apart: too far.
		expect(
			isWithinDoubleClickDistance({ cx: 0.1, cy: 0.5 }, { cx: 0.15, cy: 0.5 }, region),
		).toBe(false);
	});

	it("keeps the same meaning on a small window region", () => {
		// The old fraction-of-region rule collapsed to ~24px here; in DIP the
		// threshold is unchanged across targets.
		const region = { width: 800, height: 600 };
		expect(
			isWithinDoubleClickDistance({ cx: 0.1, cy: 0.5 }, { cx: 0.13, cy: 0.5 }, region),
		).toBe(true);
		expect(
			isWithinDoubleClickDistance({ cx: 0.1, cy: 0.5 }, { cx: 0.2, cy: 0.5 }, region),
		).toBe(false);
	});

	it("falls back to the legacy fraction when no region is known", () => {
		expect(
			isWithinDoubleClickDistance({ cx: 0.1, cy: 0.5 }, { cx: 0.12, cy: 0.5 }, null),
		).toBe(true);
		expect(
			isWithinDoubleClickDistance({ cx: 0.1, cy: 0.5 }, { cx: 0.15, cy: 0.5 }, null),
		).toBe(false);
	});
});

describe("repairBundledUiohookBinaryForCurrentArch", () => {
	const tempRoots: string[] = [];

	afterEach(async () => {
		await Promise.all(
			tempRoots
				.splice(0)
				.map((tempRoot) => fs.rm(tempRoot, { recursive: true, force: true })),
		);
	});

	it("promotes the bundled darwin-arm64 prebuild over a stale incompatible build", async () => {
		const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "morec-uiohook-"));
		tempRoots.push(tempRoot);

		const packageRoot = path.join(tempRoot, "uiohook-napi");
		const prebuildPath = path.join(packageRoot, "prebuilds", "darwin-arm64", "node.napi.node");
		const buildPath = path.join(packageRoot, "build", "Release", "uiohook_napi.node");
		await fs.mkdir(path.dirname(prebuildPath), { recursive: true });
		await fs.mkdir(path.dirname(buildPath), { recursive: true });
		await fs.writeFile(prebuildPath, "arm64-prebuild");
		await fs.writeFile(buildPath, "x64-build");

		const log = vi.fn();
		const repaired = repairBundledUiohookBinaryForCurrentArch(
			Object.assign(
				new Error(
					"mach-o file, but is an incompatible architecture (have 'x86_64', need 'arm64')",
				),
				{
					code: "ERR_DLOPEN_FAILED",
				},
			),
			{ packageRoot, platform: "darwin", arch: "arm64", log },
		);

		expect(repaired).toBe(true);
		expect(await fs.readFile(buildPath, "utf8")).toBe("arm64-prebuild");
		expect(log).toHaveBeenCalledWith(
			"[CursorTelemetry] Repaired stale uiohook-napi binary using bundled darwin-arm64 prebuild.",
		);
	});

	it("promotes the bundled win32-x64 prebuild over a broken locally built binary", async () => {
		const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "morec-uiohook-"));
		tempRoots.push(tempRoot);

		const packageRoot = path.join(tempRoot, "uiohook-napi");
		const prebuildPath = path.join(packageRoot, "prebuilds", "win32-x64", "node.napi.node");
		const buildPath = path.join(packageRoot, "build", "Release", "uiohook_napi.node");
		await fs.mkdir(path.dirname(prebuildPath), { recursive: true });
		await fs.mkdir(path.dirname(buildPath), { recursive: true });
		await fs.writeFile(prebuildPath, "win32-prebuild");
		await fs.writeFile(buildPath, "broken-local-build");

		const log = vi.fn();
		const repaired = repairBundledUiohookBinaryForCurrentArch(
			Object.assign(new Error("%1 is not a valid Win32 application"), {
				code: "ERR_DLOPEN_FAILED",
			}),
			{ packageRoot, platform: "win32", arch: "x64", log },
		);

		expect(repaired).toBe(true);
		expect(await fs.readFile(buildPath, "utf8")).toBe("win32-prebuild");
		expect(log).toHaveBeenCalledWith(
			"[CursorTelemetry] Repaired stale uiohook-napi binary using bundled win32-x64 prebuild.",
		);
	});

	it("does not rewrite binaries for unrelated load failures", async () => {
		const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "morec-uiohook-"));
		tempRoots.push(tempRoot);

		const packageRoot = path.join(tempRoot, "uiohook-napi");
		const buildPath = path.join(packageRoot, "build", "Release", "uiohook_napi.node");
		await fs.mkdir(path.dirname(buildPath), { recursive: true });
		await fs.writeFile(buildPath, "existing-build");

		const repaired = repairBundledUiohookBinaryForCurrentArch(
			Object.assign(new Error("some other dlopen failure"), {
				code: "ERR_DLOPEN_FAILED",
			}),
			{ packageRoot, platform: "darwin", arch: "arm64" },
		);

		expect(repaired).toBe(false);
		expect(await fs.readFile(buildPath, "utf8")).toBe("existing-build");
	});
});
