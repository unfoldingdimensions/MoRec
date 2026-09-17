import path from "node:path";

import { buildWindowsCmakeHelper } from "./native-cmake-helper.mjs";

const projectRoot = process.cwd();
const sourceDir = path.join(projectRoot, "electron", "native", "cursor-monitor");

const result = buildWindowsCmakeHelper({
	prefix: "build-cursor-monitor",
	helperId: "cursor-monitor",
	sourceDir,
	binaryName: "cursor-monitor.exe",
	// Arch-aware like build-windows-capture; this used to hardcode -A x64,
	// leaving the two helpers inconsistent on ARM64 hosts.
	generatorArch: process.arch === "arm64" ? "ARM64" : "x64",
	projectRoot,
});

if (result === "failed") {
	process.exit(1);
}
