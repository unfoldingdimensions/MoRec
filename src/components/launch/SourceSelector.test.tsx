// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/contexts/I18nContext";
import type { DesktopSource } from "./popovers/launchPopoverTypes";
import { SourceSelectorContent } from "./SourceSelector";

// MarqueeText observes its own overflow with ResizeObserver, which jsdom lacks.
class ResizeObserverStub {
	observe = vi.fn();
	unobserve = vi.fn();
	disconnect = vi.fn();
}

beforeEach(() => {
	vi.stubGlobal("ResizeObserver", ResizeObserverStub);
});

afterEach(() => {
	vi.unstubAllGlobals();
});


function source(partial: Partial<DesktopSource>): DesktopSource {
	return {
		id: "screen:0",
		name: "Screen 1",
		thumbnail: null,
		display_id: "0",
		appIcon: null,
		sourceType: "screen",
		...partial,
	};
}

const SCREENS = [
	source({ id: "screen:0", name: "Screen 1", sourceType: "screen" }),
	source({ id: "screen:1", name: "Screen 2", sourceType: "screen" }),
];

const WINDOWS = [
	source({
		id: "window:1",
		name: "Code",
		windowTitle: "Visual Studio Code",
		sourceType: "window",
	}),
];

function renderContent(overrides: Partial<Parameters<typeof SourceSelectorContent>[0]> = {}) {
	const props = {
		screenSources: SCREENS,
		windowSources: WINDOWS,
		selectedSource: "Screen 1",
		loading: false,
		onSourceSelect: vi.fn(),
		...overrides,
	};
	render(
		<I18nProvider>
			<SourceSelectorContent {...props} />
		</I18nProvider>,
	);
	return props;
}

describe("SourceSelectorContent", () => {
	it("shows a loading spinner when loading with no sources", () => {
		const { container } = render(
			<I18nProvider>
				<SourceSelectorContent screenSources={[]} windowSources={[]} loading />
			</I18nProvider>,
		);

		expect(container.querySelector(".animate-spin")).not.toBeNull();
		expect(screen.queryByRole("button")).not.toBeInTheDocument();
	});

	it("renders screen and window groups with their items", () => {
		renderContent();

		// MarqueeText renders each label three times (static + duplicated track).
		expect(screen.getAllByText("Screen 1").length).toBeGreaterThan(0);
		expect(screen.getAllByText("Screen 2").length).toBeGreaterThan(0);
		// Window items prefer the window title over the process name.
		expect(screen.getAllByText("Visual Studio Code").length).toBeGreaterThan(0);
	});

	it("marks the selected source", () => {
		renderContent();

		const selected = screen
			.getAllByText("Screen 1")[0]
			.closest("button") as HTMLButtonElement;
		expect(selected.className).toContain("source-selector-item-selected");

		const unselected = screen
			.getAllByText("Screen 2")[0]
			.closest("button") as HTMLButtonElement;
		expect(unselected.className).not.toContain("source-selector-item-selected");
	});

	it("dispatches the clicked source", async () => {
		const user = userEvent.setup();
		const props = renderContent();

		await user.click(screen.getAllByText("Visual Studio Code")[0]);
		expect(props.onSourceSelect).toHaveBeenCalledWith(
			expect.objectContaining({ id: "window:1", sourceType: "window" }),
		);
	});

	it("shows the empty state when no sources exist", () => {
		renderContent({ screenSources: [], windowSources: [] });

		expect(screen.queryByRole("button")).not.toBeInTheDocument();
		// The i18n key has no English fallback; assert non-empty copy is shown.
		const emptyState = document.querySelector(".source-selector-muted.text-center");
		expect(emptyState?.textContent?.length ?? 0).toBeGreaterThan(0);
	});
});
