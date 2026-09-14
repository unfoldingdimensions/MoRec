// @vitest-environment jsdom
import { act } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { ThemeProvider, useTheme } from "./ThemeContext";

const wrapper = ({ children }: { children: ReactNode }) => (
	<ThemeProvider>{children}</ThemeProvider>
);

describe("ThemeContext cross-window sync", () => {
	beforeEach(() => {
		window.localStorage.clear();
		document.documentElement.classList.remove("dark");
	});

	it("adopts a theme changed in another window via the storage event", async () => {
		const { result } = renderHook(() => useTheme(), { wrapper });
		await waitFor(() => expect(result.current.theme).toBe("light"));

		await act(async () => {
			window.dispatchEvent(
				new StorageEvent("storage", { key: "morec.theme", newValue: "dark" }),
			);
		});

		expect(result.current.theme).toBe("dark");
		expect(result.current.preference).toBe("dark");
		expect(document.documentElement.classList.contains("dark")).toBe(true);
	});

	it("ignores storage events for other keys and invalid values", async () => {
		const { result } = renderHook(() => useTheme(), { wrapper });
		await waitFor(() => expect(result.current.theme).toBe("light"));

		await act(async () => {
			window.dispatchEvent(
				new StorageEvent("storage", { key: "morec.locale", newValue: "dark" }),
			);
			window.dispatchEvent(
				new StorageEvent("storage", { key: "morec.theme", newValue: "bogus" }),
			);
		});

		expect(result.current.theme).toBe("light");
		expect(result.current.preference).toBe("system");
	});
});
