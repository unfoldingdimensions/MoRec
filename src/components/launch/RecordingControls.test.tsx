// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/contexts/I18nContext";
import { RecordingControls } from "./RecordingControls";

function renderControls(
	overrides: Partial<Parameters<typeof RecordingControls>[0]> = {},
) {
	const props = {
		paused: false,
		microphoneEnabled: true,
		elapsed: 65,
		onToggleMicrophone: vi.fn(),
		onPauseResume: vi.fn(),
		onStopRecording: vi.fn(),
		onHideHud: vi.fn(),
		onCancelRecording: vi.fn(),
		formatTime: (seconds: number) => {
			const m = Math.floor(seconds / 60)
				.toString()
				.padStart(2, "0");
			const s = (seconds % 60).toString().padStart(2, "0");
			return `${m}:${s}`;
		},
		...overrides,
	};
	render(
		<I18nProvider>
			<RecordingControls {...props} />
		</I18nProvider>,
	);
	return props;
}

describe("RecordingControls", () => {
	it("shows the live-recording indicator and elapsed time", () => {
		renderControls({ elapsed: 65 });

		expect(screen.getByText(/REC/i)).toBeInTheDocument();
		expect(screen.getByText("01:05")).toBeInTheDocument();
	});

	it("switches to the paused state with a resume action", async () => {
		const user = userEvent.setup();
		const props = renderControls({ paused: true, elapsed: 10 });

		expect(screen.getByText(/Paused/i)).toBeInTheDocument();
		expect(screen.getByText("00:10")).toBeInTheDocument();

		await user.click(screen.getByRole("button", { name: /Resume/i }));
		expect(props.onPauseResume).toHaveBeenCalledTimes(1);
	});

	it("pauses from the live state", async () => {
		const user = userEvent.setup();
		const props = renderControls({ paused: false });

		await user.click(screen.getByRole("button", { name: /Pause/i }));
		expect(props.onPauseResume).toHaveBeenCalledTimes(1);
	});

	it("stops and hides the HUD", async () => {
		const user = userEvent.setup();
		const props = renderControls();

		await user.click(screen.getByRole("button", { name: /Stop/i }));
		expect(props.onStopRecording).toHaveBeenCalledTimes(1);

		await user.click(screen.getByRole("button", { name: /Hide HUD/i }));
		expect(props.onHideHud).toHaveBeenCalledTimes(1);
	});

	it("cancels the recording from the trailing action", async () => {
		const user = userEvent.setup();
		const props = renderControls();

		await user.click(screen.getByRole("button", { name: /Cancel/i }));
		expect(props.onCancelRecording).toHaveBeenCalledTimes(1);
	});

	it("renders the microphone toggle disabled while recording", () => {
		renderControls({ microphoneEnabled: true });

		const micButton = screen.getByRole("button", { name: /microphone/i });
		expect(micButton).toBeDisabled();
	});
});
