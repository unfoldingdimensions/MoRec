// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/contexts/I18nContext";
import { TeleprompterPrompter } from "./TeleprompterPrompter";

const settingsStore = new Map<string, unknown>();

function installElectronApi() {
	const api = {
		getAppSetting: vi.fn((key: string) => settingsStore.get(key)),
		setAppSetting: vi.fn((key: string, value: unknown) => {
			settingsStore.set(key, value);
			return true;
		}),
	};
	(window as unknown as { electronAPI: unknown }).electronAPI = api;
	return api;
}

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
	beforeEach(() => {
		settingsStore.clear();
	});

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

	it("stays at the default right-third position when nothing is persisted", () => {
		installElectronApi();
		renderPrompter();

		const panel = screen.getByTestId("teleprompter-prompter");
		expect(panel).not.toHaveAttribute("style", expect.stringContaining("left"));
	});

	it("restores a persisted position on mount", () => {
		installElectronApi();
		settingsStore.set("teleprompterPosition", { x: 40, y: 60 });
		renderPrompter();

		const panel = screen.getByTestId("teleprompter-prompter");
		expect(panel).toHaveStyle({ left: "40px", top: "60px" });
	});

	it("moves with a header drag and persists the position", () => {
		const api = installElectronApi();
		renderPrompter();

		const header = screen.getByTitle(/drag to move/i);
		fireEvent.pointerDown(header, { pointerId: 1, clientX: 100, clientY: 100 });
		fireEvent.pointerMove(header, { pointerId: 1, clientX: 160, clientY: 130 });
		fireEvent.pointerUp(header, { pointerId: 1 });

		const panel = screen.getByTestId("teleprompter-prompter");
		expect(panel.style.left).toBe("60px");
		expect(panel.style.top).toBe("30px");
		expect(api.setAppSetting).toHaveBeenCalledWith(
			"teleprompterPosition",
			expect.objectContaining({ x: 60, y: 30 }),
		);
		expect(settingsStore.get("teleprompterPosition")).toMatchObject({ x: 60, y: 30 });
	});

	it("ignores sub-threshold header movement and button clicks still work", async () => {
		const user = userEvent.setup();
		const api = installElectronApi();
		const props = renderPrompter();

		const header = screen.getByTitle(/drag to move/i);
		fireEvent.pointerDown(header, { pointerId: 1, clientX: 100, clientY: 100 });
		fireEvent.pointerMove(header, { pointerId: 1, clientX: 102, clientY: 101 });
		fireEvent.pointerUp(header, { pointerId: 1 });
		expect(api.setAppSetting).not.toHaveBeenCalled();

		await user.click(screen.getByRole("button", { name: /hide hud/i }));
		expect(props.onClose).toHaveBeenCalledTimes(1);
	});
});
