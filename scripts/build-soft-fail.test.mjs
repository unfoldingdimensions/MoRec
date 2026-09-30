import { describe, expect, it } from "vitest";
import {
	formatSoftFailNotice,
	resolveChildEnv,
	resolveSoftFailPolicy,
} from "./build-soft-fail.mjs";

describe("resolveSoftFailPolicy", () => {
	const cases = [
		{
			name: "postinstall wrapper flag allows a soft fail",
			env: { MOREC_POSTINSTALL: "1" },
			allowed: true,
			reason: "MOREC_POSTINSTALL=1",
		},
		{
			name: "root postinstall event allows a soft fail",
			env: { npm_lifecycle_event: "postinstall" },
			allowed: true,
			reason: "npm_lifecycle_event=postinstall",
		},
		{
			name: "CI allows a soft fail",
			env: { CI: "true" },
			allowed: true,
			reason: "CI=true",
		},
		{
			name: "explicit opt-out allows a soft fail",
			env: { WHISPER_RUNTIME_ALLOW_MISSING: "1" },
			allowed: true,
			reason: "WHISPER_RUNTIME_ALLOW_MISSING=1",
		},
		{
			name: "release scripts must NOT soft fail",
			env: { npm_lifecycle_event: "build:win" },
			allowed: false,
		},
		{
			// REGRESSION GUARD: build:win runs this script as a child too, so a
			// name-based allowlist here would silently disable the release gate.
			name: "the helper script invoked on its own must NOT soft fail",
			env: { npm_lifecycle_event: "build:platform-native-helpers" },
			allowed: false,
		},
		{
			name: "a bare node invocation must NOT soft fail",
			env: {},
			allowed: false,
		},
		{
			name: "an unrelated lifecycle event must NOT soft fail",
			env: { npm_lifecycle_event: "prepack" },
			allowed: false,
		},
	];

	for (const testCase of cases) {
		it(testCase.name, () => {
			const result = resolveSoftFailPolicy(testCase.env);
			expect(result.softFailAllowed).toBe(testCase.allowed);
			if (testCase.reason) {
				expect(result.reasons).toContain(testCase.reason);
			}
		});
	}

	it("collects every applicable reason", () => {
		const result = resolveSoftFailPolicy({ CI: "true", WHISPER_RUNTIME_ALLOW_MISSING: "1" });
		expect(result.softFailAllowed).toBe(true);
		expect(result.reasons).toEqual(["CI=true", "WHISPER_RUNTIME_ALLOW_MISSING=1"]);
	});

	it("does not read ambient process.env when an env object is supplied", () => {
		expect(resolveSoftFailPolicy({}).softFailAllowed).toBe(false);
	});
});

describe("resolveChildEnv", () => {
	it("tags child builds as postinstall-driven", () => {
		expect(resolveChildEnv({ PATH: "/usr/bin" })).toEqual({
			PATH: "/usr/bin",
			MOREC_POSTINSTALL: "1",
		});
	});

	it("preserves the parent environment without mutating it", () => {
		const parent = { CI: "true" };
		expect(resolveChildEnv(parent)).toEqual({ CI: "true", MOREC_POSTINSTALL: "1" });
		expect(parent).toEqual({ CI: "true" });
	});

	it("overrides a stale inherited flag rather than dropping it", () => {
		expect(resolveChildEnv({ MOREC_POSTINSTALL: "0" }).MOREC_POSTINSTALL).toBe("1");
	});
});

describe("soft-fail and child-env agree", () => {
	it("a child environment produced by the postinstall wrapper is allowed to soft fail", () => {
		const childEnv = resolveChildEnv({ npm_lifecycle_event: "build:platform-native-helpers" });
		expect(resolveSoftFailPolicy(childEnv).softFailAllowed).toBe(true);
	});
});

describe("formatSoftFailNotice", () => {
	it("names the cause, the missing targets, and why it was allowed", () => {
		const notice = formatSoftFailNotice(
			"build-whisper-runtime",
			"CMake not found and no bundled runtime is staged",
			"win32-x64",
			["MOREC_POSTINSTALL=1"],
		);
		expect(notice).toContain("CMake not found and no bundled runtime is staged for: win32-x64");
		expect(notice).toContain("Continuing because MOREC_POSTINSTALL=1");
		expect(notice).toContain("npm run build:whisper-runtime");
	});
});
