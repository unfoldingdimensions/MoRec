// @vitest-environment jsdom
import { act } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CountdownOverlay } from "./CountdownOverlay";

type TickListener = (seconds: number) => void;

function installElectronApi() {
	let tickListener: TickListener | null = null;
	const electronAPI = {
		getActiveCountdown: vi.fn(async () => ({ success: true, seconds: null })),
		onCountdownTick: vi.fn((listener: TickListener) => {
			tickListener = listener;
			return () => {
				tickListener = null;
			};
		}),
		cancelCountdown: vi.fn(async () => ({ success: true })),
	};
	(window as unknown as { electronAPI: unknown }).electronAPI = electronAPI;
	return {
		electronAPI,
		emitTick: (seconds: number) => act(() => tickListener?.(seconds)),
	};
}

describe("CountdownOverlay", () => {
	beforeEach(() => {
		installElectronApi();
	});

	it("renders nothing when no countdown is active", async () => {
		const { container } = render(<CountdownOverlay />);
		await waitFor(() => {
			expect(container.firstChild).toBeNull();
		});
	});

	it("renders the active countdown seconds", async () => {
		const { electronAPI } = installElectronApi();
		electronAPI.getActiveCountdown.mockResolvedValue({ success: true, seconds: 5 });

		render(<CountdownOverlay />);
		expect(await screen.findByText("5")).toBeInTheDocument();
	});

	it("updates the displayed number on tick events", async () => {
		const { emitTick } = installElectronApi();
		const { electronAPI } = window as unknown as {
			electronAPI: { getActiveCountdown: ReturnType<typeof vi.fn> };
		};
		electronAPI.getActiveCountdown.mockResolvedValue({ success: true, seconds: 3 });

		render(<CountdownOverlay />);
		expect(await screen.findByText("3")).toBeInTheDocument();

		emitTick(2);
		expect(screen.getByText("2")).toBeInTheDocument();
		emitTick(1);
		expect(screen.queryByText("3")).not.toBeInTheDocument();
	});

	it("cancels the countdown on click", async () => {
		const { electronAPI } = installElectronApi();
		electronAPI.getActiveCountdown.mockResolvedValue({ success: true, seconds: 3 });
		const user = userEvent.setup();

		render(<CountdownOverlay />);
		await user.click(await screen.findByText("3"));

		expect(electronAPI.cancelCountdown).toHaveBeenCalledTimes(1);
	});

	it("cancels the countdown on Escape", async () => {
		const { electronAPI } = installElectronApi();
		electronAPI.getActiveCountdown.mockResolvedValue({ success: true, seconds: 3 });
		const user = userEvent.setup();

		render(<CountdownOverlay />);
		await screen.findByText("3");

		await user.keyboard("{Escape}");
		expect(electronAPI.cancelCountdown).toHaveBeenCalledTimes(1);
	});
});
