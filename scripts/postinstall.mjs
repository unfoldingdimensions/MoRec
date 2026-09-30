import { spawnSync } from "node:child_process";

import { resolveChildEnv } from "./build-soft-fail.mjs";

const npmExecPath = process.env.npm_execpath;
const hasNpmExecPath = typeof npmExecPath === "string" && npmExecPath.length > 0;
const npmInvoker = hasNpmExecPath
	? {
			command: process.execPath,
			argsPrefix: [npmExecPath],
			shell: false,
		}
	: {
			command: process.platform === "win32" ? "npm.cmd" : "npm",
			argsPrefix: [],
			shell: process.platform === "win32",
		};

function runScript(scriptName) {
	console.log(`[postinstall] Running npm script: ${scriptName}`);
	const result = spawnSync(npmInvoker.command, [...npmInvoker.argsPrefix, "run", scriptName], {
		stdio: "inherit",
		// resolveChildEnv() tags the child as postinstall-driven so optional
		// native runtimes may soft-fail here; release scripts never set this and
		// still fail loudly on a missing runtime.
		env: resolveChildEnv(),
		shell: npmInvoker.shell,
	});

	if (result.error) {
		console.error(`[postinstall] Failed to start "${scriptName}" (${result.error.message}).`);
		return false;
	}

	if (result.signal) {
		console.error(`[postinstall] "${scriptName}" was terminated by signal ${result.signal}.`);
		return false;
	}

	if (result.status !== 0) {
		console.error(`[postinstall] "${scriptName}" exited with code ${result.status}.`);
		return false;
	}

	return true;
}

if (!runScript("rebuild:native")) {
	process.exit(1);
}

if (!runScript("build:platform-native-helpers")) {
	process.exit(1);
}
