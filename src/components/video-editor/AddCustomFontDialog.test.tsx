// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/contexts/I18nContext";

const customFonts = vi.hoisted(() => ({
	addCustomFont: vi.fn(),
	isValidGoogleFontsUrl: vi.fn((url: string) => url.includes("fonts.googleapis.com")),
	parseFontFamilyFromImport: vi.fn((url: string) => {
		const match = url.match(/family=([^&:]+)/);
		return match ? match[1] : null;
	}),
	generateFontId: vi.fn((name: string) => `font-${name.toLowerCase()}`),
	DuplicateFontError: class DuplicateFontError extends Error {},
}));

const toast = vi.hoisted(() => ({
	error: vi.fn(),
	success: vi.fn(),
}));

vi.mock("@/lib/customFonts", () => customFonts);
vi.mock("sonner", () => ({ toast }));

import { AddCustomFontDialog } from "./AddCustomFontDialog";

function renderDialog(onFontAdded?: (font: unknown) => void) {
	return render(
		<I18nProvider>
			<AddCustomFontDialog onFontAdded={onFontAdded} />
		</I18nProvider>,
	);
}

describe("AddCustomFontDialog", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("renders the cancel button with its translated label (regression: raw key)", async () => {
		const user = userEvent.setup();
		renderDialog();

		await user.click(screen.getByRole("button", { name: /Add Google Font/i }));

		// Regression: this used to render the raw key "addFont.cancel".
		expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Add Font" })).toBeInTheDocument();
	});

	it("rejects an empty URL with a toast", async () => {
		const user = userEvent.setup();
		renderDialog();

		await user.click(screen.getByRole("button", { name: /Add Google Font/i }));
		await user.click(screen.getByRole("button", { name: "Add Font" }));

		expect(toast.error).toHaveBeenCalledWith("Please enter a Google Fonts import URL");
		expect(customFonts.addCustomFont).not.toHaveBeenCalled();
	});

	it("rejects a non-Google-Fonts URL", async () => {
		const user = userEvent.setup();
		renderDialog();

		await user.click(screen.getByRole("button", { name: /Add Google Font/i }));
		await user.type(screen.getByLabelText(/Google Fonts Import URL/i), "https://evil.example");
		await user.click(screen.getByRole("button", { name: "Add Font" }));

		expect(toast.error).toHaveBeenCalledWith("Please enter a valid Google Fonts URL");
	});

	it("adds a valid font, notifies the parent, and closes", async () => {
		const user = userEvent.setup();
		const onFontAdded = vi.fn();
		customFonts.addCustomFont.mockResolvedValue(undefined);
		renderDialog(onFontAdded);

		await user.click(screen.getByRole("button", { name: /Add Google Font/i }));
		// Paste-like single change: per-character typing would freeze the
		// auto-extracted name at the first partial family match.
		fireEvent.change(screen.getByLabelText(/Google Fonts Import URL/i), {
			target: { value: "https://fonts.googleapis.com/css2?family=Roboto&display=swap" },
		});
		// The name auto-extracts from the URL.
		expect(screen.getByLabelText(/Display Name/i)).toHaveValue("Roboto");
		await user.click(screen.getByRole("button", { name: "Add Font" }));

		await screen.findByRole("button", { name: /Add Google Font/i });
		expect(customFonts.addCustomFont).toHaveBeenCalledWith({
			id: "font-roboto",
			name: "Roboto",
			fontFamily: "Roboto",
			importUrl: "https://fonts.googleapis.com/css2?family=Roboto&display=swap",
		});
		expect(onFontAdded).toHaveBeenCalledWith(
			expect.objectContaining({ name: "Roboto" }),
		);
		expect(toast.success).toHaveBeenCalledWith('Font "Roboto" added successfully');
	});

	it("reports duplicates with the already-added description", async () => {
		const user = userEvent.setup();
		customFonts.addCustomFont.mockRejectedValue(new customFonts.DuplicateFontError("dup"));
		renderDialog();

		await user.click(screen.getByRole("button", { name: /Add Google Font/i }));
		// Paste-like single change: per-character typing would freeze the
		// auto-extracted name at the first partial family match.
		fireEvent.change(screen.getByLabelText(/Google Fonts Import URL/i), {
			target: { value: "https://fonts.googleapis.com/css2?family=Roboto&display=swap" },
		});
		await user.click(screen.getByRole("button", { name: "Add Font" }));

		await waitFor(() => {
			expect(toast.error).toHaveBeenCalledWith("Failed to add font", {
				description: "This font has already been added.",
			});
		});
	});
});
