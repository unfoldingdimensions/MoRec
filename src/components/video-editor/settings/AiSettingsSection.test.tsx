// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/contexts/I18nContext";
import { AiSettingsSection } from "./AiSettingsSection";

/**
 * Settings "AI" section: endpoint/model persist via app-settings, the API key
 * is only ever sent to the main process (never read back), and a stored key
 * is surfaced as a status line rather than a value.
 */

const settingsStore = new Map<string, unknown>();

function installElectronApi() {
	const api = {
		getAppSetting: vi.fn((key: string) => settingsStore.get(key)),
		setAppSetting: vi.fn((key: string, value: unknown) => {
			settingsStore.set(key, value);
			return true;
		}),
		hasAiApiKey: vi.fn(async () => ({ success: true, hasKey: false })),
		setAiApiKey: vi.fn(async () => ({ success: true })),
		clearAiApiKey: vi.fn(async () => ({ success: true })),
	};
	(window as unknown as { electronAPI: unknown }).electronAPI = api;
	return api;
}

function renderSection() {
	return render(
		<I18nProvider>
			<AiSettingsSection />
		</I18nProvider>,
	);
}

describe("AiSettingsSection", () => {
	beforeEach(() => {
		settingsStore.clear();
	});

	it("persists endpoint and model edits through app-settings", async () => {
		const user = userEvent.setup();
		const api = installElectronApi();
		renderSection();

		const endpoint = screen.getByLabelText(/endpoint url/i);
		await user.type(endpoint, "x");
		await user.tab(); // blur commits
		expect(api.setAppSetting).toHaveBeenCalledWith(
			"aiEndpoint",
			"https://api.openai.com/v1/chat/completionsx",
		);

		const model = screen.getByLabelText(/model/i);
		await user.type(model, "2");
		await user.tab();
		expect(api.setAppSetting).toHaveBeenCalledWith("aiModel", "2");
	});

	it("saves the key through IPC, shows the stored indicator, and never reads the key back", async () => {
		const user = userEvent.setup();
		const api = installElectronApi();
		api.hasAiApiKey.mockResolvedValue({ success: true, hasKey: true });
		renderSection();

		const keyField = screen.getByLabelText(/api key/i) as HTMLInputElement;
		expect(keyField.type).toBe("password");
		await user.type(keyField, "sk-test-123");
		await user.click(screen.getByRole("button", { name: /save key/i }));

		expect(api.setAiApiKey).toHaveBeenCalledWith("sk-test-123");
		expect(await screen.findByText(/API key saved/i)).toBeTruthy();
		expect(keyField.value).toBe("");

		// The renderer-side store never receives the key value from main.
		expect(settingsStore.has("aiCredentials")).toBe(false);
	});

	it("shows the stored-key status line when a key already exists", async () => {
		const api = installElectronApi();
		api.hasAiApiKey.mockResolvedValue({ success: true, hasKey: true });
		// Pre-store the endpoint so the initial load renders it.
		settingsStore.set("aiEndpoint", "https://llm.local/v1/chat/completions");
		renderSection();

		expect(await screen.findByText(/API key saved/i)).toBeTruthy();
		const endpoint = screen.getByLabelText(/endpoint url/i) as HTMLInputElement;
		expect(endpoint.value).toBe("https://llm.local/v1/chat/completions");
	});

	it("removes a stored key", async () => {
		const user = userEvent.setup();
		const api = installElectronApi();
		api.hasAiApiKey.mockResolvedValue({ success: true, hasKey: true });
		renderSection();

		await user.click(await screen.findByRole("button", { name: /remove/i }));
		expect(api.clearAiApiKey).toHaveBeenCalled();
	});
});
