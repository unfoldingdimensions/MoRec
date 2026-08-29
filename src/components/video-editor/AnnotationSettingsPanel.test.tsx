// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/contexts/I18nContext";

const customFonts = vi.hoisted(() => ({
	getCustomFonts: vi.fn(async () => []),
}));

const toast = vi.hoisted(() => ({
	error: vi.fn(),
	success: vi.fn(),
}));

vi.mock("@/lib/customFonts", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/lib/customFonts")>();
	return { ...actual, getCustomFonts: customFonts.getCustomFonts };
});

vi.mock("sonner", () => ({ toast }));

import { AnnotationSettingsPanel } from "./AnnotationSettingsPanel";
import type { AnnotationRegion } from "./types";

function makeAnnotation(overrides: Partial<AnnotationRegion> = {}): AnnotationRegion {
	return {
		id: "anno-1",
		startMs: 0,
		endMs: 5000,
		type: "text",
		content: "",
		textContent: "Hello annotation",
		position: { x: 50, y: 50 },
		size: { width: 200, height: 60 },
		zIndex: 1,
		style: {
			color: "#ffffff",
			backgroundColor: "rgba(0,0,0,0.7)",
			fontSize: 24,
			fontFamily: "system-ui, -apple-system, sans-serif",
			fontWeight: "normal",
			fontStyle: "normal",
			textDecoration: "none",
			textAlign: "left",
			borderRadius: 8,
		},
		...overrides,
	};
}

function renderPanel(annotation: AnnotationRegion) {
	const props = {
		annotation,
		onContentChange: vi.fn(),
		onTypeChange: vi.fn(),
		onStyleChange: vi.fn(),
	};
	render(
		<I18nProvider>
			<AnnotationSettingsPanel {...props} />
		</I18nProvider>,
	);
	return props;
}

describe("AnnotationSettingsPanel", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("renders the text annotation content in the text tab", () => {
		renderPanel(makeAnnotation());

		expect(screen.getByText(/Settings/i)).toBeInTheDocument();
		expect(screen.getByDisplayValue("Hello annotation")).toBeInTheDocument();
		expect(screen.getByRole("tab", { name: /Text/i })).toHaveAttribute(
			"aria-selected",
			"true",
		);
	});

	it("commits text edits", async () => {
		const user = userEvent.setup();
		const props = renderPanel(makeAnnotation());

		await user.type(screen.getByDisplayValue("Hello annotation"), "!");
		// The textarea commits on change (controlled by the parent).
		expect(props.onContentChange).toHaveBeenLastCalledWith("Hello annotation!");
	});

	it("switches annotation types from the tab list", async () => {
		const user = userEvent.setup();
		const props = renderPanel(makeAnnotation());

		await user.click(screen.getByRole("tab", { name: /Image/i }));
		expect(props.onTypeChange).toHaveBeenCalledWith("image");
	});

	it("rejects non-image uploads with translated toasts (regression: raw keys)", async () => {
		const props = renderPanel(makeAnnotation({ type: "image" }));

		const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
		expect(fileInput).not.toBeNull();
		const textFile = new File(["not an image"], "notes.txt", { type: "text/plain" });
		fireEvent.change(fileInput, { target: { files: [textFile] } });

		// Regression: these keys used to render raw ("annotations.imageUploadErrorDescription").
		expect(toast.error).toHaveBeenCalledWith(
			"Please upload a JPG, PNG, GIF, or WebP image file.",
			{
				description: "Only JPG, PNG, GIF, WebP, AVIF, and SVG images are supported.",
			},
		);
		expect(props.onContentChange).not.toHaveBeenCalled();
	});

	it("accepts a valid image upload and forwards the data URL", async () => {
		const props = renderPanel(makeAnnotation({ type: "image" }));

		const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
		const png = new File([new Uint8Array([137, 80, 78, 71])], "logo.png", {
			type: "image/png",
		});
		fireEvent.change(fileInput, { target: { files: [png] } });

		// Sonner is mocked, so assert the calls rather than the DOM.
		await vi.waitFor(() => {
			expect(toast.success).toHaveBeenCalledWith("Image uploaded successfully!");
		});
		expect(props.onContentChange).toHaveBeenCalledWith(
			expect.stringContaining("data:image/png;base64,"),
		);
		expect(props.onContentChange).toHaveBeenCalledWith(
			expect.stringContaining("data:image/png;base64,"),
		);
	});

	it("reports unreadable image files instead of raw keys", async () => {
		renderPanel(makeAnnotation({ type: "image" }));

		const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
		const broken = new File([new Uint8Array([1])], "broken.png", { type: "image/png" });
		vi.spyOn(FileReader.prototype, "readAsDataURL").mockImplementation(function (
			this: FileReader,
		) {
			this.onerror?.(new Event("error"));
		});
		fireEvent.change(fileInput, { target: { files: [broken] } });

		await vi.waitFor(() => {
			expect(toast.error).toHaveBeenCalledWith("Could not read the image file.", {
				description: "The file could not be read. It may be corrupted or unsupported.",
			});
		});
	});
});
