// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/contexts/I18nContext";
import { MicPreflight } from "./MicPreflight";

// The hook's threshold state machine is covered by useAudioLevelMeter tests;
// here the hook is stubbed so the card's render/clear wiring is tested alone.
const meterState = vi.hoisted(() => ({
	current: { level: 0, clipping: false, noInput: false },
}));

vi.mock("@/hooks/useAudioLevelMeter", () => ({
	useAudioLevelMeter: () => meterState.current,
}));

function renderCard(systemAudioEnabled: boolean) {
	return render(
		<I18nProvider>
			<MicPreflight deviceId="mic-1" systemAudioEnabled={systemAudioEnabled} />
		</I18nProvider>,
	);
}

afterEach(() => {
	meterState.current = { level: 0, clipping: false, noInput: false };
});

describe("MicPreflight", () => {
	it("shows the system-audio state chip only while system audio is enabled", () => {
		const enabled = renderCard(true);
		expect(screen.getByTestId("system-audio-chip")).toHaveTextContent(
			/ystem audio will be captured/i,
		);
		enabled.unmount();

		const disabled = renderCard(false);
		expect(screen.queryByTestId("system-audio-chip")).not.toBeInTheDocument();
		disabled.unmount();
	});

	it("renders the clipping warning while the meter reports clipping", () => {
		const view = renderCard(false);
		expect(screen.queryByTestId("mic-clipping-warning")).not.toBeInTheDocument();

		meterState.current = { level: 100, clipping: true, noInput: false };
		view.rerender(
			<I18nProvider>
				<MicPreflight deviceId="mic-1" systemAudioEnabled={false} />
			</I18nProvider>,
		);
		expect(screen.getByTestId("mic-clipping-warning")).toBeInTheDocument();

		meterState.current = { level: 80, clipping: false, noInput: false };
		view.rerender(
			<I18nProvider>
				<MicPreflight deviceId="mic-1" systemAudioEnabled={false} />
			</I18nProvider>,
		);
		expect(screen.queryByTestId("mic-clipping-warning")).not.toBeInTheDocument();
	});

	it("renders the no-input warning while the meter reports silence", () => {
		const view = renderCard(false);
		expect(screen.queryByTestId("mic-no-input-warning")).not.toBeInTheDocument();

		meterState.current = { level: 0, clipping: false, noInput: true };
		view.rerender(
			<I18nProvider>
				<MicPreflight deviceId="mic-1" systemAudioEnabled={false} />
			</I18nProvider>,
		);
		expect(screen.getByTestId("mic-no-input-warning")).toBeInTheDocument();

		meterState.current = { level: 60, clipping: false, noInput: false };
		view.rerender(
			<I18nProvider>
				<MicPreflight deviceId="mic-1" systemAudioEnabled={false} />
			</I18nProvider>,
		);
		expect(screen.queryByTestId("mic-no-input-warning")).not.toBeInTheDocument();
	});
});
