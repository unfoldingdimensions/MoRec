import path from "node:path";

import { buildWindowsCmakeHelper } from "./native-cmake-helper.mjs";

const projectRoot = process.cwd();
const sourceDir = path.join(projectRoot, "electron", "native", "wgc-capture");

const result = buildWindowsCmakeHelper({
	prefix: "build-windows-capture",
	helperId: "wgc-capture",
	sourceDir,
	binaryName: "wgc-capture.exe",
	generatorArch: process.arch === "arm64" ? "ARM64" : "x64",
	projectRoot,
});

if (result === "failed") {
	process.exit(1);
}
