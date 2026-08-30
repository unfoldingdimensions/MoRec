// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExtensionInfo, MarketplaceExtension } from "@/lib/extensions";
import { I18nProvider } from "@/contexts/I18nContext";

const toast = vi.hoisted(() => ({
	error: vi.fn(),
	success: vi.fn(),
}));

const extensionsFacade = vi.hoisted(() => ({
	extensions: [] as never[],
	activeIds: new Set<string>(),
	ready: true,
	refresh: vi.fn(async () => undefined),
	toggleExtension: vi.fn(async () => true),
	installFromFolder: vi.fn(async () => true),
	uninstall: vi.fn(async () => true),
	openDirectory: vi.fn(async () => undefined),
	marketplaceSearch: vi.fn(async () => ({ extensions: [] as never[], total: 0 })),
	marketplaceInstall: vi.fn(async () => ({ success: true })),
}));

vi.mock("sonner", () => ({ toast }));
vi.mock("@/hooks/useExtensions", () => ({
	useExtensions: vi.fn(() => extensionsFacade),
}));

import ExtensionManager from "./ExtensionManager";

function makeMarketplaceExtension(
	overrides: Partial<MarketplaceExtension> = {},
): MarketplaceExtension {
	return {
		id: "com.example.cool",
		name: "Cool Extension",
		version: "1.2.0",
		description: "Does cool things",
		author: "Jane",
		downloadUrl: "https://marketplace.morec.app/packs/cool.zip",
		downloads: 100,
		rating: 4.5,
		ratingCount: 12,
		...overrides,
	} as MarketplaceExtension;
}

function makeInstalledExtension(): ExtensionInfo {
	return {
		manifest: {
			id: "com.example.local",
			name: "Local Extension",
			version: "0.1.0",
			main: "index.js",
			permissions: [],
			description: "Installed locally",
		},
		status: "installed",
		path: "/userdata/extensions/com.example.local",
	} as ExtensionInfo;
}

async function renderManager() {
	const view = render(
		<I18nProvider>
			<ExtensionManager />
		</I18nProvider>,
	);
	await waitFor(() => {
		expect(extensionsFacade.marketplaceSearch).toHaveBeenCalled();
	});
	return view;
}

describe("ExtensionManager", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		extensionsFacade.extensions = [];
		extensionsFacade.activeIds = new Set<string>();
		extensionsFacade.ready = true;
		extensionsFacade.marketplaceSearch.mockResolvedValue({
			extensions: [],
			total: 0,
		});
		extensionsFacade.marketplaceInstall.mockResolvedValue({ success: true });
		extensionsFacade.refresh.mockResolvedValue(undefined);
	});

	it("shows a loading spinner until the extensions host is ready", () => {
		extensionsFacade.ready = false;
		render(
			<I18nProvider>
				<ExtensionManager />
			</I18nProvider>,
		);

		// The spinner is rendered instead of the tab content (the auto-search
		// effect still fires; only the content render is gated on ready).
		expect(document.querySelector(".animate-spin")).not.toBeNull();
	});

	it("auto-searches the marketplace when the browse tab mounts", async () => {
		extensionsFacade.marketplaceSearch.mockResolvedValue({
			extensions: [makeMarketplaceExtension()],
			total: 1,
		});
		await renderManager();

		expect(extensionsFacade.marketplaceSearch).toHaveBeenCalledWith({
			query: undefined,
			sort: "popular",
			pageSize: 50,
		});
		expect(await screen.findByText("Cool Extension")).toBeInTheDocument();
	});

	it("shows search failures instead of results", async () => {
		extensionsFacade.marketplaceSearch.mockRejectedValue(new Error("marketplace down"));
		await renderManager();

		expect(await screen.findByText(/marketplace down/)).toBeInTheDocument();
	});

	it("refreshes and reports success", async () => {
		const user = userEvent.setup();
		await renderManager();

		await user.click(screen.getByTitle(/Refresh/i));
		await waitFor(() => {
			expect(toast.success).toHaveBeenCalled();
		});
		expect(extensionsFacade.refresh).toHaveBeenCalledTimes(1);
	});

	it("reports refresh failures", async () => {
		const user = userEvent.setup();
		extensionsFacade.refresh.mockRejectedValue(new Error("host gone"));
		await renderManager();

		await user.click(screen.getByTitle(/Refresh/i));
		await waitFor(() => {
			expect(toast.error).toHaveBeenCalled();
		});
	});

	it("installs marketplace extensions and flips the installed flag", async () => {
		const user = userEvent.setup();
		extensionsFacade.marketplaceSearch.mockResolvedValue({
			extensions: [makeMarketplaceExtension()],
			total: 1,
		});
		await renderManager();

		const installButton = await screen.findByRole("button", { name: "Install" });
		await user.click(installButton);
		await waitFor(() => {
			expect(extensionsFacade.marketplaceInstall).toHaveBeenCalledWith(
				"com.example.cool",
				"https://marketplace.morec.app/packs/cool.zip",
			);
			expect(toast.success).toHaveBeenCalledWith(
				expect.stringContaining("Cool Extension"),
			);
		});
	});

	it("reports failed marketplace installs with the error", async () => {
		const user = userEvent.setup();
		extensionsFacade.marketplaceSearch.mockResolvedValue({
			extensions: [makeMarketplaceExtension()],
			total: 1,
		});
		extensionsFacade.marketplaceInstall.mockResolvedValue({
			success: false,
			error: "disk full",
		});
		await renderManager();

		const installButton = await screen.findByRole("button", { name: "Install" });
		await user.click(installButton);
		await waitFor(() => {
			expect(toast.error).toHaveBeenCalledWith(
				expect.stringContaining("Cool Extension"),
				{ description: "disk full" },
			);
		});
	});

	it("lists installed extensions on the installed tab", async () => {
		const user = userEvent.setup();
		extensionsFacade.extensions = [makeInstalledExtension()];
		await renderManager();

		await user.click(screen.getByText(/Installed/i));
		expect(await screen.findByText("Local Extension")).toBeInTheDocument();
	});
});
