/**
 * Soft-fail policy for optional native runtimes (currently only whisper.cpp).
 *
 * A development postinstall and CI may continue without an optional runtime;
 * direct invocations of the release scripts (`npm run build`, `build:win`,
 * `build:mac`, `build:linux`) must fail loudly so a release is never shipped
 * silently missing it.
 *
 * IMPORTANT: the release scripts run `build:platform-native-helpers` as a
 * CHILD npm script, so the child reports `npm_lifecycle_event` as
 * "build:platform-native-helpers" rather than "postinstall". Allowing that
 * event name here would also let release builds soft-fail and silently ship
 * broken auto-captions. The postinstall wrapper therefore signals its intent
 * explicitly through `resolveChildEnv()` instead, which release paths never do.
 */

const SOFT_FAIL_REASONS = [
	["MOREC_POSTINSTALL", "1", "MOREC_POSTINSTALL=1"],
	["npm_lifecycle_event", "postinstall", "npm_lifecycle_event=postinstall"],
	["CI", "true", "CI=true"],
	["WHISPER_RUNTIME_ALLOW_MISSING", "1", "WHISPER_RUNTIME_ALLOW_MISSING=1"],
];

/**
 * Decide whether an optional runtime may be skipped for this invocation.
 * Pure: reads only the supplied environment object.
 *
 * @param {Record<string, string | undefined>} [env]
 * @returns {{ softFailAllowed: boolean, reasons: string[] }}
 */
export function resolveSoftFailPolicy(env = process.env) {
	const reasons = [];
	for (const [key, expected, label] of SOFT_FAIL_REASONS) {
		if (env[key] === expected) {
			reasons.push(label);
		}
	}

	return { softFailAllowed: reasons.length > 0, reasons };
}

/**
 * Environment for a build step spawned by `scripts/postinstall.mjs`.
 *
 * Hoisted out of postinstall.mjs so it can be unit tested without importing
 * that module (importing it runs the full native build as a side effect), and
 * because `import.meta.main` is unavailable on the Node 22 used by CI.
 *
 * @param {Record<string, string | undefined>} [parentEnv]
 * @returns {Record<string, string | undefined>}
 */
export function resolveChildEnv(parentEnv = process.env) {
	return { ...parentEnv, MOREC_POSTINSTALL: "1" };
}

/**
 * Human-readable warning for a skipped optional runtime.
 *
 * @param {string} label build-script label, e.g. "build-whisper-runtime"
 * @param {string} cause what was missing or failed, e.g. "CMake not found"
 * @param {string} missing comma-separated arch tags
 * @param {string[]} reasons reasons reported by resolveSoftFailPolicy
 */
export function formatSoftFailNotice(label, cause, missing, reasons) {
	return (
		`[${label}] ${cause} for: ${missing}. Continuing because ${reasons.join(", ")}. ` +
		"Auto-caption features that rely on whisper.cpp will be unavailable until you install " +
		"CMake + MSVC and rerun `npm run build:whisper-runtime`."
	);
}
