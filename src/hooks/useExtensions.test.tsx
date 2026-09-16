// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExtensionInfo } from "@/lib/extensions";

/**
 * Renderer-side consent enforcement in useExtensions: the hook must inspect
 * the `extensionsEnable` result and refuse to activate an extension (and
 * must report enablement truthfully to install callers) when the main
 * process declined or failed the enable.
 */

const extensionHostFacade = vi.hoisted(() => ({
	syncConfiguredExtensions: vi.fn(async () => undefined),
	getActiveExtensions: vi.fn(() => [] as ExtensionInfo[]),
	onChange: vi.fn(() => () => {}),
	activateExtension: vi.fn(async () => undefined),
	deactivateExtension: vi.fn(async () => undefined),
}));

vi.mock("@/lib/extensions", () => ({
	extensionHost: extensionHostFacade,
}));

const TEST_ID = "com.example.test";

function makeExtensionInfo(): ExtensionInfo {
	return {
		manifest: {
			id: TEST_ID,
			name: "Test Extension",
			version: "1.0.0",
			main: "index.js",
			permissions: [],
			description: "Test",
		},
		status: "installed",
		path: "/userdata/extensions/com.example.test",
	};
}

type ElectronApiStub = Record<string, ReturnType<typeof vi.fn>>;

function installElectronApi(overrides: Record<string, unknown> = {}): ElectronApiStub {
	const api: ElectronApiStub = {
		extensionsDiscover: vi.fn(async () => [makeExtensionInfo()]),
		extensionsEnable: vi.fn(async () => true),
		extensionsDisable: vi.fn(async () => true),
		extensionsInstallFromFolder: vi.fn(async () => ({ success: false })),
		extensionsUninstall: vi.fn(async () => ({ success: false })),
		extensionsOpenDirectory: vi.fn(async () => undefined),
		extensionsMarketplaceSearch: vi.fn(async () => ({
			extensions: [],
			total: 0,
			page: 1,
			pageSize: 20,
		})),
		extensionsMarketplaceInstall: vi.fn(async () => ({ success: false })),
		extensionsMarketplaceSubmit: vi.fn(async () => ({ success: false })),
		extensionsReviewsList: vi.fn(async () => ({ reviews: [], total: 0 })),
		extensionsReviewUpdate: vi.fn(async () => ({ success: false })),
		...overrides,
	};
	(window as unknown as { electronAPI: unknown }).electronAPI = api;
	return api;
}

async function loadHook() {
	// The hook captures window.electronAPI at module scope, so the mock must
	// be installed before the (re)import.
	vi.resetModules();
	return (await import("./useExtensions")).useExtensions;
}

describe("useExtensions consent enforcement", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		extensionHostFacade.getActiveExtensions.mockReturnValue([]);
	});

	it("does not activate an extension when the enable consent is cancelled", async () => {
		const electronAPI = installElectronApi({
			extensionsEnable: vi.fn(async () => ({ success: false, reason: "cancelled" })),
		});
		const useExtensions = await loadHook();

		const { result } = renderHook(() => useExtensions());
		await waitFor(() => {
			expect(result.current.ready).toBe(true);
		});

		await act(() => result.current.toggleExtension(TEST_ID));

		expect(electronAPI.extensionsEnable).toHaveBeenCalledWith(TEST_ID);
		expect(extensionHostFacade.activateExtension).not.toHaveBeenCalled();
		expect(result.current.activeIds.has(TEST_ID)).toBe(false);
		expect(result.current.extensions.find((e) => e.manifest.id === TEST_ID)?.status).toBe(
			"disabled",
		);
	});

	it("treats any success:false enable result as a refusal", async () => {
		const electronAPI = installElectronApi({
			extensionsEnable: vi.fn(async () => ({ success: false })),
		});
		const useExtensions = await loadHook();

		const { result } = renderHook(() => useExtensions());
		await waitFor(() => {
			expect(result.current.ready).toBe(true);
		});

		await act(() => result.current.toggleExtension(TEST_ID));

		expect(extensionHostFacade.activateExtension).not.toHaveBeenCalled();
		expect(electronAPI.extensionsDisable).not.toHaveBeenCalled();
	});

	it("activates as before when the enable call succeeds", async () => {
		installElectronApi({
			extensionsEnable: vi.fn(async () => true),
		});
		const useExtensions = await loadHook();

		const { result } = renderHook(() => useExtensions());
		await waitFor(() => {
			expect(result.current.ready).toBe(true);
		});

		await act(() => result.current.toggleExtension(TEST_ID));

		expect(extensionHostFacade.activateExtension).toHaveBeenCalledTimes(1);
		const [info, moduleUrl] = extensionHostFacade.activateExtension.mock.calls[0];
		expect(info.manifest.id).toBe(TEST_ID);
		expect(String(moduleUrl)).toContain("file://");
		expect(String(moduleUrl)).toContain("index.js");
		expect(result.current.extensions.find((e) => e.manifest.id === TEST_ID)?.status).toBe(
			"active",
		);
	});

	it("reports installed-but-not-enabled when the folder install enable is declined", async () => {
		const electronAPI = installElectronApi({
			extensionsInstallFromFolder: vi.fn(async () => ({
				success: true,
				extension: { manifest: { id: TEST_ID } },
			})),
			extensionsEnable: vi.fn(async () => ({ success: false, reason: "cancelled" })),
		});
		const useExtensions = await loadHook();

		const { result } = renderHook(() => useExtensions());
		await waitFor(() => {
			expect(result.current.ready).toBe(true);
		});

		let outcome: { installed: boolean; enabled: boolean } | undefined;
		await act(async () => {
			outcome = await result.current.installFromFolder();
		});

		expect(outcome).toEqual({ installed: true, enabled: false });
		expect(electronAPI.extensionsEnable).toHaveBeenCalledWith(TEST_ID);
	});

	it("reports enabled:true when the folder install enable succeeds", async () => {
		installElectronApi({
			extensionsInstallFromFolder: vi.fn(async () => ({
				success: true,
				extension: { manifest: { id: TEST_ID } },
			})),
			extensionsEnable: vi.fn(async () => true),
		});
		const useExtensions = await loadHook();

		const { result } = renderHook(() => useExtensions());
		await waitFor(() => {
			expect(result.current.ready).toBe(true);
		});

		let outcome: { installed: boolean; enabled: boolean } | undefined;
		await act(async () => {
			outcome = await result.current.installFromFolder();
		});

		expect(outcome).toEqual({ installed: true, enabled: true });
	});

	it("surfaces declined enablement on marketplace installs", async () => {
		const electronAPI = installElectronApi({
			extensionsMarketplaceInstall: vi.fn(async () => ({ success: true })),
			extensionsEnable: vi.fn(async () => ({ success: false, reason: "cancelled" })),
		});
		const useExtensions = await loadHook();

		const { result } = renderHook(() => useExtensions());
		await waitFor(() => {
			expect(result.current.ready).toBe(true);
		});

		let outcome: { success: boolean; enabled: boolean } | undefined;
		await act(async () => {
			outcome = await result.current.marketplaceInstall(
				TEST_ID,
				"https://marketplace.morec.app/packs/test.zip",
			);
		});

		expect(outcome).toEqual({ success: true, enabled: false });
		expect(electronAPI.extensionsEnable).toHaveBeenCalledWith(TEST_ID);
	});

	it("surfaces enabled:true on marketplace installs when enable succeeds", async () => {
		installElectronApi({
			extensionsMarketplaceInstall: vi.fn(async () => ({ success: true })),
			extensionsEnable: vi.fn(async () => true),
		});
		const useExtensions = await loadHook();

		const { result } = renderHook(() => useExtensions());
		await waitFor(() => {
			expect(result.current.ready).toBe(true);
		});

		let outcome: { success: boolean; enabled: boolean } | undefined;
		await act(async () => {
			outcome = await result.current.marketplaceInstall(
				TEST_ID,
				"https://marketplace.morec.app/packs/test.zip",
			);
		});

		expect(outcome).toEqual({ success: true, enabled: true });
	});
});
