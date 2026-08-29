// @vitest-environment jsdom
import { act } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { I18nProvider, useI18n, useScopedT } from "./I18nContext";

const wrapper = ({ children }: { children: ReactNode }) => <I18nProvider>{children}</I18nProvider>;

describe("I18nContext", () => {
	beforeEach(() => {
		window.localStorage.clear();
	});

	it("resolves namespaced keys", async () => {
		const { result } = renderHook(() => useI18n().t("launch.recording.record"), { wrapper });
		await waitFor(() => {
			expect(result.current).toBe("Record");
		});
	});

	it("falls back to the provided fallback for unknown keys", async () => {
		const { result } = renderHook(() => useI18n().t("launch.recording.does.not.exist", "My Fallback"), {
			wrapper,
		});
		await waitFor(() => {
			expect(result.current).toBe("My Fallback");
		});
	});

	it("returns the raw key when there is no fallback and no message", async () => {
		const { result } = renderHook(() => useI18n().t("launch.recording.does.not.exist"), { wrapper });
		await waitFor(() => {
			expect(result.current).toBe("launch.recording.does.not.exist");
		});
	});

	it("interpolates {{variables}} into resolved messages", async () => {
		const { result } = renderHook(
			() => useI18n().t("editor.presets.toasts.applied", undefined, { name: "Zoom Preset" }),
			{ wrapper },
		);
		await waitFor(() => {
			expect(result.current).toBe('Applied preset "Zoom Preset"');
		});
	});

	it("useScopedT resolves keys inside its namespace", async () => {
		const { result } = renderHook(() => useScopedT("launch")("recording.record"), { wrapper });
		await waitFor(() => {
			expect(result.current).toBe("Record");
		});
	});

	it("switches locale, retranslates, and persists the choice", async () => {
		const { result } = renderHook(() => useI18n(), { wrapper });

		await waitFor(() => expect(result.current.locale).toBe("en"));

		await act(async () => {
			result.current.setLocale("de");
		});

		expect(result.current.t("launch.recording.record")).toBe("Aufnehmen");
		expect(window.localStorage.getItem("morec.locale")).toBe("de");
	});

	it("keeps the en value when a key is missing from the selected locale", async () => {
		const { result } = renderHook(() => useI18n(), { wrapper });
		await act(async () => {
			result.current.setLocale("de");
		});

		// common.app.* was backfilled in en; German falls through to it.
		expect(result.current.t("common.app.name")).toBe("Mo Rec");
	});
});
