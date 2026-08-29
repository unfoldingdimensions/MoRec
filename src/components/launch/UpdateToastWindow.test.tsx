// @vitest-environment jsdom
import { act } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UpdateToastPayload } from "@/updater";
import { UpdateToastWindow } from "./UpdateToastWindow";

type ToastListener = (payload: UpdateToastPayload | null) => void;

const AVAILABLE: UpdateToastPayload = {
	version: "1.1.0",
	detail: "Mo Rec 1.1.0 is available.",
	phase: "available",
	delayMs: 3 * 60 * 60 * 1000,
	primaryAction: "install-and-restart",
};

const DOWNLOADING: UpdateToastPayload = {
	version: "1.1.0",
	detail: "Downloading Mo Rec 1.1.0",
	phase: "downloading",
	delayMs: 3 * 60 * 60 * 1000,
	progressPercent: 42,
	transferredBytes: 42 * 1024 * 1024,
	totalBytes: 100 * 1024 * 1024,
	remainingBytes: 58 * 1024 * 1024,
	bytesPerSecond: 1024 * 1024,
};

function installElectronApi(initialPayload: UpdateToastPayload | null = null) {
	let toastListener: ToastListener | null = null;
	// Model the main-process state: the poll and the push listener read the
	// same value, so a pushed payload is not clobbered by the next poll.
	let currentPayload = initialPayload;
	const electronAPI = {
		getCurrentUpdateToastPayload: vi.fn(async () => currentPayload),
		onUpdateToastStateChanged: vi.fn((listener: ToastListener) => {
			toastListener = listener;
			return () => {
				toastListener = null;
			};
		}),
		checkForAppUpdates: vi.fn(async () => undefined),
		installDownloadedUpdate: vi.fn(async () => undefined),
		downloadAvailableUpdate: vi.fn(async () => undefined),
		dismissUpdateToast: vi.fn(async () => undefined),
		deferDownloadedUpdate: vi.fn(async () => undefined),
	};
	(window as unknown as { electronAPI: unknown }).electronAPI = electronAPI;
	return {
		electronAPI,
		pushPayload: (payload: UpdateToastPayload | null) =>
			act(() => {
				currentPayload = payload;
				toastListener?.(payload);
			}),
	};
}

describe("UpdateToastWindow", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("renders an empty wrapper when there is no toast payload", async () => {
		installElectronApi(null);
		const { container } = render(<UpdateToastWindow />);

		await waitFor(() => {
			expect(container.querySelector("p")).toBeNull();
		});
	});

	it("renders the available-update toast with actions", async () => {
		installElectronApi(AVAILABLE);
		render(<UpdateToastWindow />);

		expect(await screen.findByText("Mo Rec 1.1.0 is available")).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Install & Restart" })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Later" })).toBeInTheDocument();
	});

	it("installs the downloaded update when ready", async () => {
		const { electronAPI } = installElectronApi({
			...AVAILABLE,
			phase: "ready",
		});
		const user = userEvent.setup();
		render(<UpdateToastWindow />);

		await user.click(await screen.findByRole("button", { name: "Install & Restart" }));
		expect(electronAPI.installDownloadedUpdate).toHaveBeenCalledTimes(1);
	});

	it("downloads the available update from the primary action", async () => {
		const { electronAPI } = installElectronApi(AVAILABLE);
		const user = userEvent.setup();
		render(<UpdateToastWindow />);

		await user.click(await screen.findByRole("button", { name: "Install & Restart" }));
		expect(electronAPI.downloadAvailableUpdate).toHaveBeenCalledWith(true);
	});

	it("retries the update check from an error toast", async () => {
		const { electronAPI } = installElectronApi({
			...AVAILABLE,
			phase: "error",
			primaryAction: "retry-check",
		});
		const user = userEvent.setup();
		render(<UpdateToastWindow />);

		await user.click(await screen.findByRole("button", { name: "Try Again" }));
		expect(electronAPI.checkForAppUpdates).toHaveBeenCalledTimes(1);
	});

	it("defers with the selected reminder delay", async () => {
		const { electronAPI } = installElectronApi(AVAILABLE);
		const user = userEvent.setup();
		render(<UpdateToastWindow />);

		await screen.findByText("Mo Rec 1.1.0 is available");
		await user.selectOptions(screen.getByRole("combobox"), "1 hour");
		await user.click(screen.getByRole("button", { name: "Later" }));

		expect(electronAPI.deferDownloadedUpdate).toHaveBeenCalledWith(60 * 60 * 1000);
	});

	it("dismisses instead of deferring for the dev preview", async () => {
		const { electronAPI } = installElectronApi({ ...AVAILABLE, isPreview: true });
		const user = userEvent.setup();
		render(<UpdateToastWindow />);

		expect(await screen.findByText("Update Prompt Preview")).toBeInTheDocument();
		await user.click(screen.getByRole("button", { name: "Later" }));
		expect(electronAPI.dismissUpdateToast).toHaveBeenCalledTimes(1);
	});

	it("shows download progress with transfer statistics and no action buttons", async () => {
		installElectronApi(DOWNLOADING);
		render(<UpdateToastWindow />);

		expect(await screen.findByText("Installing Mo Rec 1.1.0")).toBeInTheDocument();
		expect(screen.getByText("42% complete")).toBeInTheDocument();
		// Label and value are separate text nodes inside one span; match the
		// span's full text with a regex.
		expect(screen.getByText(/Downloaded: 42\.0 MB \/ 100 MB/)).toBeInTheDocument();
		expect(screen.getByText(/Left: 58\.0 MB/)).toBeInTheDocument();
		expect(screen.getByText(/Speed: 1\.0 MB\/s/)).toBeInTheDocument();
		expect(screen.queryByRole("button", { name: "Later" })).not.toBeInTheDocument();
	});

	it("updates live when the main process pushes a toast state change", async () => {
		const { pushPayload } = installElectronApi(null);
		render(<UpdateToastWindow />);

		pushPayload(AVAILABLE);
		await waitFor(() => {
			expect(screen.queryByText("Mo Rec 1.1.0 is available")).toBeInTheDocument();
		});

		pushPayload(null);
		await waitFor(() => {
			expect(screen.queryByText("Mo Rec 1.1.0 is available")).not.toBeInTheDocument();
		});
	});
});
