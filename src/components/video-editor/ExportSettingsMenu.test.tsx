// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/contexts/I18nContext";
import { ExportSettingsMenu } from "./ExportSettingsMenu";

function renderMenu(overrides: Partial<Parameters<typeof ExportSettingsMenu>[0]> = {}) {
	const props = {
		exportFormat: "mp4" as const,
		onExportFormatChange: vi.fn(),
		exportQuality: "good" as const,
		onExportQualityChange: vi.fn(),
		exportEncodingMode: "balanced" as const,
		onExportEncodingModeChange: vi.fn(),
		mp4FrameRate: 30,
		onMp4FrameRateChange: vi.fn(),
		exportPipelineModel: "modern" as const,
		onExportPipelineModelChange: vi.fn(),
		experimentalNvidiaCudaExport: false,
		onExperimentalNvidiaCudaExportChange: vi.fn(),
		nvidiaCudaExportAvailable: true,
		showCaptionSidecarOption: true,
		includeCaptionSidecar: false,
		onIncludeCaptionSidecarChange: vi.fn(),
		gifFrameRate: 15,
		onGifFrameRateChange: vi.fn(),
		gifLoop: true,
		onGifLoopChange: vi.fn(),
		gifSizePreset: "source",
		onGifSizePresetChange: vi.fn(),
		gifOutputDimensions: { width: 1920, height: 1080 },
		onExport: vi.fn(),
		...overrides,
	} as Parameters<typeof ExportSettingsMenu>[0];
	const view = render(
		<I18nProvider>
			<ExportSettingsMenu {...props} />
		</I18nProvider>,
	);
	return { ...view, props };
}

describe("ExportSettingsMenu", () => {
	it("renders format options and dispatches format changes", async () => {
		const user = userEvent.setup();
		const { props } = renderMenu();

		expect(screen.getByRole("button", { name: /MP4/i })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: /GIF/i })).toBeInTheDocument();

		await user.click(screen.getByRole("button", { name: /GIF/i }));
		expect(props.onExportFormatChange).toHaveBeenCalledWith("gif");
	});

	it("renders quality options and dispatches changes", async () => {
		const user = userEvent.setup();
		const { props } = renderMenu();

		await user.click(screen.getByRole("button", { name: /High/i }));
		expect(props.onExportQualityChange).toHaveBeenCalledWith("high");
	});

	it("shows the mp4-only sections and dispatches encoding, fps, and pipeline changes", async () => {
		const user = userEvent.setup();
		const { props } = renderMenu();

		expect(screen.getByText(/Encoding/i)).toBeInTheDocument();
		expect(screen.getByText(/FPS/i)).toBeInTheDocument();
		expect(screen.getByText(/Pipeline/i)).toBeInTheDocument();

		await user.click(screen.getByRole("button", { name: /Fast/i }));
		expect(props.onExportEncodingModeChange).toHaveBeenCalledWith("fast");

		await user.click(screen.getByRole("button", { name: "60" }));
		expect(props.onMp4FrameRateChange).toHaveBeenCalledWith(60);

		await user.click(screen.getByRole("button", { name: /Legacy/i }));
		expect(props.onExportPipelineModelChange).toHaveBeenCalledWith("legacy");
	});

	it("hides the mp4-only sections for gif exports and shows gif options", () => {
		renderMenu({ exportFormat: "gif" });

		expect(screen.queryByText(/Pipeline/i)).not.toBeInTheDocument();
		expect(screen.getByText(/Loop/i)).toBeInTheDocument();
	});

	it("toggles the caption sidecar option when shown", async () => {
		const user = userEvent.setup();
		const { props } = renderMenu();

		const sidecarSwitch = screen.getByRole("switch", {
			name: /Export captions sidecar files/i,
		});
		await user.click(sidecarSwitch);
		expect(props.onIncludeCaptionSidecarChange).toHaveBeenCalledWith(true);
	});

	it("offers the CUDA toggle only when the export backend is available", async () => {
		const user = userEvent.setup();
		const available = renderMenu({ nvidiaCudaExportAvailable: true });
		expect(screen.getByText(/NVIDIA CUDA/i)).toBeInTheDocument();

		await user.click(screen.getByRole("switch", { name: /NVIDIA CUDA/i }));
		expect(available.props.onExperimentalNvidiaCudaExportChange).toHaveBeenCalledWith(true);
		available.unmount();

		const unavailable = renderMenu({ nvidiaCudaExportAvailable: false });
		expect(screen.queryByText(/NVIDIA CUDA/i)).not.toBeInTheDocument();
		unavailable.unmount();
	});

	it("toggles the gif loop option", async () => {
		const user = userEvent.setup();
		const { props } = renderMenu({ exportFormat: "gif", gifLoop: false });

		// The loop switch has no accessible label (its text is a sibling span).
		const loopSwitch = screen.getByRole("switch");
		await user.click(loopSwitch);
		expect(props.onGifLoopChange).toHaveBeenCalledWith(true);
	});

	it("exports with the format-aware label", async () => {
		const user = userEvent.setup();
		const { props } = renderMenu();

		await user.click(screen.getByRole("button", { name: /Export Video/i }));
		expect(props.onExport).toHaveBeenCalledTimes(1);

		renderMenu({ exportFormat: "gif" });
		expect(screen.getByRole("button", { name: /Export GIF/i })).toBeInTheDocument();
	});
});
