// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/contexts/I18nContext";
import { ShortcutsProvider, useShortcuts } from "@/contexts/ShortcutsContext";
import { isShortcutCaptureActive } from "@/lib/shortcutCaptureState";

const toast = vi.hoisted(() => ({
	error: vi.fn(),
	success: vi.fn(),
	info: vi.fn(),
}));

vi.mock("sonner", () => ({ toast }));

vi.mock("@/utils/platformUtils", () => ({
	isMac: vi.fn(async () => false),
}));

import { ShortcutsConfigDialog } from "./ShortcutsConfigDialog";

function ConfigOpener({ onOpen }: { onOpen?: () => void }) {
	const { openConfig } = useShortcuts();
	useEffect(() => {
		openConfig();
		onOpen?.();
	}, [openConfig, onOpen]);
	return null;
}

async function renderOpenDialog() {
	return render(
		<I18nProvider>
			<ShortcutsProvider>
				<ConfigOpener />
				<ShortcutsConfigDialog />
			</ShortcutsProvider>
		</I18nProvider>,
	);
}

describe("ShortcutsConfigDialog", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("reports the capture window through the shared capture flag", async () => {
		const user = userEvent.setup();
		await renderOpenDialog();

		expect(await screen.findByRole("dialog")).toBeInTheDocument();
		expect(isShortcutCaptureActive()).toBe(false);

		// Start capturing the playPause binding (Space row).
		await user.click(await screen.findByRole("button", { name: /Space/i }));

		expect(isShortcutCaptureActive()).toBe(true);

		await user.keyboard("{Escape}");

		await waitFor(() => {
			expect(isShortcutCaptureActive()).toBe(false);
		});
	});
});
