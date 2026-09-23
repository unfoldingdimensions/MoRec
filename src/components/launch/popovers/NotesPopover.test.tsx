// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/contexts/I18nContext";
import { HudInteractionContext } from "../contexts/HudInteractionContext";
import { LaunchPopoverCoordinatorProvider } from "./LaunchPopoverCoordinator";
import { NotesPopover } from "./NotesPopover";
import { PROMPTER_BASE_SPEED_PX_PER_SEC, TELEPROMPTER_SPEED_OPTIONS } from "../prompterScroll";

function renderNotes(overrides: Partial<Parameters<typeof NotesPopover>[0]> = {}) {
	const props = {
		notes: "existing notes",
		fontSize: 20,
		scrollSpeed: 40,
		onNotesChange: vi.fn(),
		onFontSizeChange: vi.fn(),
		onScrollSpeedChange: vi.fn(),
		trigger: <button type="button">open-notes</button>,
		...overrides,
	};
	render(
		<I18nProvider>
			<HudInteractionContext.Provider
				value={{ onMouseEnter: () => {}, onMouseLeave: () => {} }}
			>
				<LaunchPopoverCoordinatorProvider>
					<NotesPopover {...props} />
				</LaunchPopoverCoordinatorProvider>
			</HudInteractionContext.Provider>
		</I18nProvider>,
	);
	return props;
}

describe("NotesPopover", () => {
	it("opens from the trigger and edits the persisted notes value", async () => {
		const user = userEvent.setup();
		const props = renderNotes();

		await user.click(screen.getByText("open-notes"));

		const textarea = screen.getByLabelText(/notes/i) as HTMLTextAreaElement;
		expect(textarea.value).toBe("existing notes");
		await user.type(textarea, "!");
		expect(props.onNotesChange).toHaveBeenCalledWith("existing notes!");
	});

	it("selects font size and scroll speed presets", async () => {
		const user = userEvent.setup();
		const props = renderNotes();

		await user.click(screen.getByText("open-notes"));

		await user.click(screen.getByRole("button", { name: "28" }));
		expect(props.onFontSizeChange).toHaveBeenCalledWith(28);

		const fastMultiplier = `${TELEPROMPTER_SPEED_OPTIONS.at(-1)! / PROMPTER_BASE_SPEED_PX_PER_SEC}×`;
		await user.click(screen.getByRole("button", { name: fastMultiplier }));
		expect(props.onScrollSpeedChange).toHaveBeenCalledWith(TELEPROMPTER_SPEED_OPTIONS.at(-1));
	});
});
