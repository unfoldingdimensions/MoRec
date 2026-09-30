import { existsSync } from "node:fs";

/**
 * `C:\Windows\System32\tar.exe` — bsdtar, shipped with Windows 10 1803+.
 * Present on every supported Windows version unless deliberately stripped.
 *
 * A literal, not a path.join: this is always a native Windows path, and
 * path.join would produce a POSIX-mangled value on the non-Windows CI runner.
 */
export const WINDOWS_SYSTEM_TAR = "C:\\Windows\\System32\\tar.exe";

/**
 * Pick the tar executable used to unpack the whisper.cpp source archive.
 *
 * On Windows, `tar` resolved from PATH is frequently MSYS/GNU tar, which reads
 * a native `D:\...` argument as an rsh-style remote host and fails with
 * "tar (child): Cannot connect to D: resolve failed". Windows ships bsdtar in
 * System32, which handles native drive paths correctly, so prefer it when it
 * exists and keep plain `tar` everywhere else (and as the fallback).
 *
 * @param {{ platform?: NodeJS.Platform, fileExists?: (candidate: string) => boolean }} [options]
 * @returns {string} executable path or bare command name
 */
export function resolveTarCommand({ platform = process.platform, fileExists = existsSync } = {}) {
	if (platform === "win32" && fileExists(WINDOWS_SYSTEM_TAR)) {
		return WINDOWS_SYSTEM_TAR;
	}

	return "tar";
}
