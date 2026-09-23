// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/contexts/I18nContext";
import type { CaptionCue } from "./types";
import CaptionListPanel from "./CaptionListPanel";

const toast = vi.hoisted(() => ({
	info: vi.fn(),
	error: vi.fn(),
	success: vi.fn(),
}));

vi.mock("sonner", () => ({ toast }));

function cue(partial: Partial<CaptionCue>): CaptionCue {
	return { id: "cue-1", text: "Hello world", startMs: 1000, endMs: 2000, ...partial };
}

const CUES = [
	cue({ id: "cue-1", text: "Hello world", startMs: 1000, endMs: 2500 }),
	cue({ id: "cue-2", text: "Second caption", startMs: 3000, endMs: 4500 }),
];

const TIMED_CUES = [
	cue({
		id: "cue-1",
		text: "Hello world",
		startMs: 1000,
		endMs: 2000,
		words: [
			{ text: "Hello", startMs: 1000, endMs: 1500 },
			{ text: "world", startMs: 1600, endMs: 2000, leadingSpace: true },
		],
	}),
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
	beforeEach(() => {
		toast.info.mockClear();
		toast.error.mockClear();
		toast.success.mockClear();
	});

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

	it("disables Split for a single-word cue", () => {
		renderPanel({
			cues: [cue({ id: "cue-1", text: "Exactly", startMs: 1000, endMs: 2500 })],
		});

		expect(screen.getByRole("button", { name: /Split/i })).toBeDisabled();
	});

	it("keeps Split enabled for multi-word cues", () => {
		renderPanel({
			cues: [cue({ id: "cue-1", text: "Two words", startMs: 1000, endMs: 2500 })],
		});

		expect(screen.getByRole("button", { name: /Split/i })).toBeEnabled();
	});

	it("disables Split when explicit word timings hold a single word", () => {
		renderPanel({
			cues: [
				cue({
					id: "cue-1",
					text: "Exactly",
					startMs: 1000,
					endMs: 2500,
					words: [{ text: "Exactly", startMs: 1000, endMs: 2500 }],
				}),
			],
		});

		expect(screen.getByRole("button", { name: /Split/i })).toBeDisabled();
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

	it("toasts when a cleared caption reverts instead of saving silently", async () => {
		const user = userEvent.setup();
		renderPanel();

		const textarea = screen.getByDisplayValue("Hello world");
		await user.clear(textarea);
		await user.tab();

		expect(toast.info).toHaveBeenCalledTimes(1);
		expect(screen.getByDisplayValue("Hello world")).toBeInTheDocument();
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

describe("CaptionListPanel cut mode", () => {
	beforeEach(() => {
		toast.info.mockClear();
		toast.error.mockClear();
		toast.success.mockClear();
	});

	async function enterCutMode(user: ReturnType<typeof userEvent.setup>) {
		await user.click(screen.getByRole("button", { name: /Cut mode/i }));
	}

	it("swaps the caption editor for word chips when cut mode is toggled", async () => {
		const user = userEvent.setup();
		renderPanel({ cues: TIMED_CUES });

		await enterCutMode(user);

		expect(screen.queryByDisplayValue("Hello world")).not.toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Hello" })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "world" })).toBeInTheDocument();

		await user.click(screen.getByRole("button", { name: /Cut mode/i }));
		expect(screen.getByDisplayValue("Hello world")).toBeInTheDocument();
		expect(screen.queryByRole("button", { name: "Hello" })).not.toBeInTheDocument();
	});

	it("starts with a disabled cut action and enables it with the selection summary", async () => {
		const user = userEvent.setup();
		renderPanel({ cues: TIMED_CUES, onCutTranscriptWords: vi.fn(() => true) });

		await enterCutMode(user);
		expect(screen.getByRole("button", { name: /Cut 0 words/i })).toBeDisabled();

		await user.click(screen.getByRole("button", { name: "Hello" }));
		expect(screen.getByRole("button", { name: /Cut 1 words \(0\.5s\)/i })).toBeEnabled();

		await user.click(screen.getByRole("button", { name: "world" }));
		expect(screen.getByRole("button", { name: /Cut 2 words \(0\.9s\)/i })).toBeEnabled();

		// Toggling the same word off removes it again.
		await user.click(screen.getByRole("button", { name: "world" }));
		expect(screen.getByRole("button", { name: /Cut 1 words \(0\.5s\)/i })).toBeEnabled();
	});

	it("marks selected words as pressed", async () => {
		const user = userEvent.setup();
		renderPanel({ cues: TIMED_CUES, onCutTranscriptWords: vi.fn(() => true) });

		await enterCutMode(user);
		const hello = screen.getByRole("button", { name: "Hello" });
		expect(hello).toHaveAttribute("aria-pressed", "false");

		await user.click(hello);
		expect(hello).toHaveAttribute("aria-pressed", "true");
	});

	it("passes the selected word spans to the cut handler and clears on success", async () => {
		const user = userEvent.setup();
		const onCutTranscriptWords = vi.fn(() => true);
		renderPanel({ cues: TIMED_CUES, onCutTranscriptWords });

		await enterCutMode(user);
		await user.click(screen.getByRole("button", { name: "Hello" }));
		await user.click(screen.getByRole("button", { name: "world" }));
		await user.click(screen.getByRole("button", { name: /Cut 2 words/i }));

		expect(onCutTranscriptWords).toHaveBeenCalledTimes(1);
		expect(onCutTranscriptWords).toHaveBeenCalledWith([
			{ startMs: 1000, endMs: 1500 },
			{ startMs: 1600, endMs: 2000 },
		]);
		// A successful cut clears the selection.
		expect(screen.getByRole("button", { name: /Cut 0 words/i })).toBeDisabled();
		expect(screen.getByRole("button", { name: "Hello" })).toHaveAttribute(
			"aria-pressed",
			"false",
		);
	});

	it("keeps the selection when the cut handler rejects it", async () => {
		const user = userEvent.setup();
		const onCutTranscriptWords = vi.fn(() => false);
		renderPanel({ cues: TIMED_CUES, onCutTranscriptWords });

		await enterCutMode(user);
		await user.click(screen.getByRole("button", { name: "Hello" }));
		await user.click(screen.getByRole("button", { name: /Cut 1 words/i }));

		expect(screen.getByRole("button", { name: /Cut 1 words/i })).toBeEnabled();
		expect(screen.getByRole("button", { name: "Hello" })).toHaveAttribute(
			"aria-pressed",
			"true",
		);
	});

	it("merges the word selection across cues", async () => {
		const user = userEvent.setup();
		const onCutTranscriptWords = vi.fn(() => true);
		const props = {
			cues: TIMED_CUES,
			selectedCaptionId: "cue-1",
			currentTimeMs: 1500,
			onBeginCaptionEdit: vi.fn(),
			onCaptionTextEdit: vi.fn(),
			onCaptionRetime: vi.fn(),
			onCaptionSplit: vi.fn(),
			onCaptionMerge: vi.fn(),
			onCaptionDelete: vi.fn(),
			onCutTranscriptWords,
		};
		const view = render(
			<I18nProvider>
				<CaptionListPanel {...props} />
			</I18nProvider>,
		);

		await enterCutMode(user);
		await user.click(screen.getByRole("button", { name: "Hello" }));

		// Switch to the second cue; the earlier selection still counts.
		view.rerender(
			<I18nProvider>
				<CaptionListPanel {...props} selectedCaptionId="cue-2" />
			</I18nProvider>,
		);
		await user.click(screen.getByRole("button", { name: "Second" }));
		expect(screen.getByRole("button", { name: /Cut 2 words/i })).toBeEnabled();

		await user.click(screen.getByRole("button", { name: /Cut 2 words/i }));
		expect(onCutTranscriptWords).toHaveBeenCalledWith([
			{ startMs: 1000, endMs: 1500 },
			{ startMs: 3000, endMs: 3750 },
		]);
	});

	it("ignores stale selections whose words no longer exist", async () => {
		const user = userEvent.setup();
		const onCutTranscriptWords = vi.fn(() => true);
		const props = {
			cues: TIMED_CUES,
			selectedCaptionId: "cue-1",
			currentTimeMs: 1500,
			onBeginCaptionEdit: vi.fn(),
			onCaptionTextEdit: vi.fn(),
			onCaptionRetime: vi.fn(),
			onCaptionSplit: vi.fn(),
			onCaptionMerge: vi.fn(),
			onCaptionDelete: vi.fn(),
			onCutTranscriptWords,
		};
		const view = render(
			<I18nProvider>
				<CaptionListPanel {...props} />
			</I18nProvider>,
		);

		await enterCutMode(user);
		await user.click(screen.getByRole("button", { name: "Hello" }));

		// Replace the cues entirely: the previously selected word is gone.
		view.rerender(
			<I18nProvider>
				<CaptionListPanel
					{...props}
					cues={[
						cue({ id: "cue-9", text: "Different take", startMs: 5000, endMs: 6000 }),
					]}
					selectedCaptionId="cue-9"
				/>
			</I18nProvider>,
		);

		expect(screen.getByRole("button", { name: /Cut 0 words/i })).toBeDisabled();
		await user.click(screen.getByRole("button", { name: /Cut 0 words/i }));
		expect(onCutTranscriptWords).not.toHaveBeenCalled();
	});
});
