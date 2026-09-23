// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/contexts/I18nContext";
import { TeleprompterPrompter } from "./TeleprompterPrompter";

function renderPrompter(overrides: Partial<Parameters<typeof TeleprompterPrompter>[0]> = {}) {
	const props = {
		notes: "Welcome to the demo.\nSecond line of the script.",
		fontSize: 24,
		scrollSpeed: 40,
		recording: true,
		paused: false,
		onClose: vi.fn(),
		...overrides,
	};
	render(
		<I18nProvider>
			<TeleprompterPrompter {...props} />
		</I18nProvider>,
	);
	return props;
}

describe("TeleprompterPrompter", () => {
	it("renders the notes and identifies itself for assistive tech", () => {
		renderPrompter();

		expect(screen.getByTestId("teleprompter-prompter")).toBeInTheDocument();
		expect(screen.getByText(/Welcome to the demo./)).toBeInTheDocument();
		// Auto-scrolling starts out active: the tap affordance offers pausing.
		expect(screen.getByText(/tap to pause/i)).toBeInTheDocument();
	});

	it("shows the empty-notes placeholder when no notes are set", () => {
		renderPrompter({ notes: "" });

		expect(screen.getByText(/type your talking points here/i)).toBeInTheDocument();
	});

	it("taps to pause and taps again to resume", async () => {
		const user = userEvent.setup();
		renderPrompter();

		const surface = screen.getByText(/Welcome to the demo./);
		await user.click(surface);
		expect(screen.getByText(/tap to resume/i)).toBeInTheDocument();

		await user.click(screen.getByText(/Welcome to the demo./));
		expect(screen.getByText(/tap to pause/i)).toBeInTheDocument();
	});

	it("collapses via the close button", async () => {
		const user = userEvent.setup();
		const props = renderPrompter();

		await user.click(screen.getByRole("button", { name: /hide hud/i }));
		expect(props.onClose).toHaveBeenCalledTimes(1);
	});

	it("applies the configured font size to the scroll surface", () => {
		renderPrompter({ fontSize: 28 });

		// The notes are a direct text child of the scroll surface div.
		const surface = screen.getByText(/Welcome to the demo./);
		expect(surface).toHaveStyle({ fontSize: "28px" });
	});
});
