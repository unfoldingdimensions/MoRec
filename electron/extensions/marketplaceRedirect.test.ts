import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Redirect-safety tests for marketplace fetches: `fetchWithTrustedRedirects`
 * must re-validate the origin of every redirect hop against the same
 * allowlist the downloader uses, so a compromised marketplace server or CDN
 * path cannot 302 an extension download (or an API call) to attacker
 * infrastructure. The final integration case proves the zip download is
 * gated end-to-end: an off-origin redirect fails the install and the
 * attacker URL is never requested.
 */

const TRUSTED = "https://marketplace.morec.app";

function redirectResponse(status: number, location: string) {
	return new Response(null, { status, headers: { location } });
}

describe("marketplace redirect safety", () => {
	let tempDir: string;

	beforeEach(async () => {
		vi.resetModules();
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "morec-redirect-test-"));
		vi.doMock("electron", () => ({
			app: {
				getAppPath: () => process.cwd(),
				getPath: () => tempDir,
				getVersion: () => "0.0.0-test",
				isPackaged: true,
			},
		}));
	});

	afterEach(async () => {
		vi.resetModules();
		vi.doUnmock("electron");
		vi.unstubAllGlobals();
		await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
	});

	async function importMarketplace() {
		return import("./extensionMarketplace");
	}

	it("rejects a redirect that leaves the trusted origins without requesting it", async () => {
		const fetchMock = vi.fn(async () => redirectResponse(302, "https://evil.example/x.zip"));
		vi.stubGlobal("fetch", fetchMock);
		const { fetchWithTrustedRedirects, isTrustedDownloadOrigin } = await importMarketplace();

		await expect(
			fetchWithTrustedRedirects(`${TRUSTED}/packs/a.zip`, undefined, isTrustedDownloadOrigin),
		).rejects.toThrow("Untrusted download origin: https://evil.example");

		// Only the trusted first hop was ever requested.
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(String(fetchMock.mock.calls[0][0])).toBe(`${TRUSTED}/packs/a.zip`);
	});

	it("rejects an untrusted initial URL before any request", async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);
		const { fetchWithTrustedRedirects, isTrustedDownloadOrigin } = await importMarketplace();

		await expect(
			fetchWithTrustedRedirects(
				"https://evil.example/x.zip",
				undefined,
				isTrustedDownloadOrigin,
			),
		).rejects.toThrow("Untrusted download origin: https://evil.example");
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("follows a redirect chain that stays on trusted origins", async () => {
		const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
			const url = String(input);
			if (url === `${TRUSTED}/packs/a.zip`) {
				return redirectResponse(301, "/packs/b.zip");
			}
			if (url === `${TRUSTED}/packs/b.zip`) {
				return redirectResponse(308, `${TRUSTED}/packs/final.zip`);
			}
			if (url === `${TRUSTED}/packs/final.zip`) {
				return new Response("zip-bytes", { status: 200 });
			}
			throw new Error(`Unexpected fetch: ${url}`);
		});
		vi.stubGlobal("fetch", fetchMock);
		const { fetchWithTrustedRedirects, isTrustedDownloadOrigin } = await importMarketplace();

		const response = await fetchWithTrustedRedirects(
			`${TRUSTED}/packs/a.zip`,
			{ headers: { "X-MoRec-Version": "0.0.0-test" } },
			isTrustedDownloadOrigin,
		);

		expect(response.status).toBe(200);
		expect(await response.text()).toBe("zip-bytes");
		expect(fetchMock).toHaveBeenCalledTimes(3);

		// Every hop must be requested with redirects disabled so none can skip
		// the origin check, and the caller's init must survive the merge.
		for (const call of fetchMock.mock.calls) {
			expect((call[1] as RequestInit).redirect).toBe("manual");
			expect((call[1] as RequestInit).headers).toEqual({
				"X-MoRec-Version": "0.0.0-test",
			});
		}
	});

	it("gives up after more than the allowed number of redirects", async () => {
		let hop = 0;
		const fetchMock = vi.fn(async () => redirectResponse(302, `${TRUSTED}/hop-${++hop}`));
		vi.stubGlobal("fetch", fetchMock);
		const { fetchWithTrustedRedirects, isTrustedDownloadOrigin } = await importMarketplace();

		await expect(
			fetchWithTrustedRedirects(`${TRUSTED}/hop-0`, undefined, isTrustedDownloadOrigin),
		).rejects.toThrow("Too many redirects while downloading extension");
		// Default maxRedirects = 5 → the initial hop plus five follow-ups.
		expect(fetchMock).toHaveBeenCalledTimes(6);
	});

	it("honours a custom maxRedirects cap", async () => {
		let hop = 0;
		const fetchMock = vi.fn(async () => redirectResponse(302, `${TRUSTED}/hop-${++hop}`));
		vi.stubGlobal("fetch", fetchMock);
		const { fetchWithTrustedRedirects, isTrustedDownloadOrigin } = await importMarketplace();

		await expect(
			fetchWithTrustedRedirects(`${TRUSTED}/hop-0`, undefined, isTrustedDownloadOrigin, 1),
		).rejects.toThrow("Too many redirects while downloading extension");
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it("returns non-redirect responses through unchanged", async () => {
		const fetchMock = vi.fn(
			async () =>
				new Response(JSON.stringify({ ok: true }), {
					status: 200,
					headers: { "content-type": "application/json" },
				}),
		);
		vi.stubGlobal("fetch", fetchMock);
		const { fetchWithTrustedRedirects, isTrustedDownloadOrigin } = await importMarketplace();

		const response = await fetchWithTrustedRedirects(
			`${TRUSTED}/extensions`,
			undefined,
			isTrustedDownloadOrigin,
		);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ ok: true });
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("returns error statuses (including 304) instead of following them", async () => {
		const fetchMock = vi.fn(async () => new Response(null, { status: 404 }));
		vi.stubGlobal("fetch", fetchMock);
		const { fetchWithTrustedRedirects, isTrustedDownloadOrigin } = await importMarketplace();

		const response = await fetchWithTrustedRedirects(
			`${TRUSTED}/extensions/missing`,
			undefined,
			isTrustedDownloadOrigin,
		);

		expect(response.status).toBe(404);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("rejects a redirect response without a Location header", async () => {
		const fetchMock = vi.fn(async () => new Response(null, { status: 302 }));
		vi.stubGlobal("fetch", fetchMock);
		const { fetchWithTrustedRedirects, isTrustedDownloadOrigin } = await importMarketplace();

		await expect(
			fetchWithTrustedRedirects(`${TRUSTED}/packs/a.zip`, undefined, isTrustedDownloadOrigin),
		).rejects.toThrow("has no Location header");
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("downloadAndInstallExtension refuses a zip download redirected off-origin", async () => {
		const fetchMock = vi.fn(async () => redirectResponse(302, "https://evil.example/x.zip"));
		vi.stubGlobal("fetch", fetchMock);
		const { downloadAndInstallExtension } = await importMarketplace();

		const result = await downloadAndInstallExtension(
			"com.example.redirected",
			`${TRUSTED}/packs/redirected.zip`,
		);

		expect(result.success).toBe(false);
		expect(result.error).toContain("Untrusted download origin");
		expect(result.error).toContain("https://evil.example");
		// The attacker URL was never fetched and no further hops were tried.
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});
});
