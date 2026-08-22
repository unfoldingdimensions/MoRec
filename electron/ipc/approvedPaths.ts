import path from "node:path";

// Trusted root directory -> allowed file basenames within that directory.
const approvedWriteTargets = new Map<string, Set<string>>();

/**
 * Register a destination the app itself chose (save-dialog result or the
 * smoke-export harness output). Export write IPCs only accept registered
 * destinations, so a compromised renderer cannot pick arbitrary write paths.
 *
 * Kept free of Electron imports so pure modules (caption sidecars) can use it
 * without pulling the main-process environment into unit tests.
 */
export function approveUserWritePath(filePath: string | null | undefined): void {
	if (!filePath) return;
	try {
		const resolved = path.resolve(filePath);
		const root = path.dirname(resolved);
		const base = path.basename(resolved);
		const allowed = approvedWriteTargets.get(root) ?? new Set<string>();
		allowed.add(base);
		approvedWriteTargets.set(root, allowed);
	} catch {
		// Ignore invalid paths; the export will fail validation instead.
	}
}

/**
 * Resolve a renderer-supplied destination against the write allowlist. The
 * target is rebuilt from the trusted root plus a whitelisted basename, so a
 * crafted path (traversal segments, separator tricks) cannot pass validation.
 * Returns the safe resolved target, or null when the destination is unknown.
 */
export function resolveApprovedUserWritePath(
	filePath: string | null | undefined,
): string | null {
	if (!filePath || typeof filePath !== "string") return null;
	try {
		const resolved = path.resolve(filePath);
		const root = path.dirname(resolved);
		const base = path.basename(resolved);
		const allowed = approvedWriteTargets.get(path.resolve(root));
		if (!allowed || !allowed.has(base)) return null;
		const target = path.resolve(root, base);
		return target === resolved ? target : null;
	} catch {
		return null;
	}
}

export function isApprovedUserWritePath(filePath: string | null | undefined): boolean {
	return resolveApprovedUserWritePath(filePath) !== null;
}
