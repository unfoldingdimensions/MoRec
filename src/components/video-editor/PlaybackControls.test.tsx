// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/contexts/I18nContext";
import PlaybackControls from "./PlaybackControls";

function renderControls(overrides: Partial<Parameters<typeof PlaybackControls>[0]> = {}) {
	const props = {
		isPlaying: false,
		currentTime: 5,
		duration: 60,
		onTogglePlayPause: vi.fn(),
		onSeek: vi.fn(),
		volume: 0.5,
		onVolumeChange: vi.fn(),
		...overrides,
	};
	const view = render(
		<I18nProvider>
			<PlaybackControls {...props} />
		</I18nProvider>,
	);
	return { ...view, props };
}

describe("PlaybackControls", () => {
	it("renders formatted current and total times", () => {
		renderControls({ currentTime: 65, duration: 600 });

		expect(screen.getByText("1:05")).toBeInTheDocument();
		expect(screen.getByText("10:00")).toBeInTheDocument();
	});

	it("formats invalid durations as 0:00", () => {
		renderControls({ duration: Number.NaN });

		expect(screen.getByText("0:00")).toBeInTheDocument();
	});

	it("toggles play/pause and updates the accessible label", async () => {
		const user = userEvent.setup();
		const { props, rerender } = renderControls();

		expect(screen.getByRole("button", { name: /play/i })).toBeInTheDocument();
		await user.click(screen.getByRole("button", { name: /play/i }));
		expect(props.onTogglePlayPause).toHaveBeenCalledTimes(1);

		rerender(
			<I18nProvider>
				<PlaybackControls {...props} isPlaying />
			</I18nProvider>,
		);
		expect(screen.getByRole("button", { name: /pause/i })).toBeInTheDocument();
	});

	it("seeks from the progress slider", async () => {
		const { container, props } = renderControls();

		const sliders = container.querySelectorAll('input[type="range"]');
		expect(sliders).toHaveLength(2); // [seek, volume]

		fireEvent.change(sliders[0], { target: { value: "30.5" } });
		expect(props.onSeek).toHaveBeenCalledWith(30.5);
	});

	it("changes volume from the volume slider", async () => {
		const { container, props } = renderControls();

		const sliders = container.querySelectorAll('input[type="range"]');
		fireEvent.change(sliders[1], { target: { value: "0.2" } });
		expect(props.onVolumeChange).toHaveBeenCalledWith(0.2);
	});

	it("reflects the progress position as a percentage", () => {
		const { container } = renderControls({ currentTime: 30, duration: 60 });

		const fill = container.querySelector<HTMLElement>(".bg-\\[\\#2563EB\\]");
		expect(fill?.style.width).toBe("50%");
	});
});
