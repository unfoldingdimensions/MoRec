// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/contexts/I18nContext";
import type { CaptionCue } from "./types";
import CaptionListPanel from "./CaptionListPanel";

function cue(partial: Partial<CaptionCue>): CaptionCue {
	return { id: "cue-1", text: "Hello world", startMs: 1000, endMs: 2000, ...partial };
}

const CUES = [
	cue({ id: "cue-1", text: "Hello world", startMs: 1000, endMs: 2500 }),
	cue({ id: "cue-2", text: "Second caption", startMs: 3000, endMs: 4500 }),
];

function renderPanel(overrides: Partial<Parameters<typeof CaptionListPanel>[0]> = {}) {
	const props = {
		cues: CUES,
		selectedCaptionId: "cue-1",
		currentTimeMs: 1500,
		onBeginCaptionEdit: vi.fn(),
		onCaptionTextEdit: vi.fn(),
		onCaptionRetime: vi.fn(),
		onCaptionSplit: vi.fn(),
		onCaptionMerge: vi.fn(),
		onCaptionDelete: vi.fn(),
		...overrides,
	};
	render(
		<I18nProvider>
			<CaptionListPanel {...props} />
		</I18nProvider>,
	);
	return props;
}

describe("CaptionListPanel", () => {
	it("renders nothing when no caption is selected", () => {
		const { container } = render(
			<I18nProvider>
				<CaptionListPanel
					cues={CUES}
					selectedCaptionId={null}
					currentTimeMs={0}
					onBeginCaptionEdit={vi.fn()}
					onCaptionTextEdit={vi.fn()}
					onCaptionRetime={vi.fn()}
					onCaptionSplit={vi.fn()}
					onCaptionMerge={vi.fn()}
					onCaptionDelete={vi.fn()}
				/>
			</I18nProvider>,
		);
		expect(container.firstChild).toBeNull();
	});

	it("renders the selected cue with timecodes and text", () => {
		renderPanel();

		expect(screen.getByDisplayValue("Hello world")).toBeInTheDocument();
		expect(screen.getByDisplayValue("0:01.000")).toBeInTheDocument();
		expect(screen.getByDisplayValue("0:02.500")).toBeInTheDocument();
	});

	it("commits trimmed text edits on blur and skips empty edits", async () => {
		const user = userEvent.setup();
		const props = renderPanel();

		const textarea = screen.getByDisplayValue("Hello world");
		await user.clear(textarea);
		await user.type(textarea, "  Edited caption  ");
		await user.tab();
		expect(props.onCaptionTextEdit).toHaveBeenCalledWith("cue-1", "Edited caption");

		await user.clear(textarea);
		await user.tab();
		expect(props.onCaptionTextEdit).toHaveBeenCalledTimes(1);
	});

	it("discards text edits on Escape", async () => {
		const user = userEvent.setup();
		const props = renderPanel();

		const textarea = screen.getByDisplayValue("Hello world");
		await user.type(textarea, " typing");
		await user.type(textarea, "{Escape}");
		// The blur after Escape discards instead of committing.
		await user.tab();
		expect(props.onCaptionTextEdit).not.toHaveBeenCalled();
		expect(screen.getByDisplayValue("Hello world")).toBeInTheDocument();
	});

	it("rejects invalid retimes and keeps the original values", async () => {
		const user = userEvent.setup();
		const props = renderPanel();

		const endInput = screen.getByDisplayValue("0:02.500");
		await user.clear(endInput);
		await user.type(endInput, "0:00.500"); // before the start
		await user.tab();
		expect(props.onCaptionRetime).not.toHaveBeenCalled();
		expect(screen.getByDisplayValue("0:02.500")).toBeInTheDocument();
	});

	it("commits valid retimes", async () => {
		const user = userEvent.setup();
		const props = renderPanel();

		const endInput = screen.getByDisplayValue("0:02.500");
		await user.clear(endInput);
		await user.type(endInput, "0:04.250");
		await user.tab();
		expect(props.onCaptionRetime).toHaveBeenCalledWith("cue-1", {
			startMs: 1000,
			endMs: 4250,
		});
	});

	it("splits at the clamped current time", async () => {
		const user = userEvent.setup();
		const props = renderPanel({ currentTimeMs: 9000 }); // beyond the cue

		await user.click(screen.getByRole("button", { name: /Split/i }));
		expect(props.onCaptionSplit).toHaveBeenCalledWith("cue-1", 2500);
	});

	it("merges with the next cue only when one exists", async () => {
		const user = userEvent.setup();
		const props = renderPanel();

		await user.click(screen.getByRole("button", { name: /Merge/i }));
		expect(props.onCaptionMerge).toHaveBeenCalledWith("cue-1", "cue-2");
	});

	it("disables merge for the last cue", () => {
		renderPanel({ selectedCaptionId: "cue-2" });

		expect(screen.getByRole("button", { name: /Merge/i })).toBeDisabled();
	});

	it("deletes the selected cue", async () => {
		const user = userEvent.setup();
		const props = renderPanel();

		await user.click(screen.getByRole("button", { name: /Delete/i }));
		expect(props.onCaptionDelete).toHaveBeenCalledWith("cue-1");
	});
});
