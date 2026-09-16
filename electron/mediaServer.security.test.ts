import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { approvedLocalReadPaths } from "./ipc/state";
import { buildMediaUrl, closeMediaServer, ensureMediaServer } from "./mediaServer";

/**
 * Security tests for the media server's request gates: the Host-header check
 * (DNS-rebinding defense) and the per-session capability token. Requests go
 * through node:http (not fetch) so the Host header can be spoofed explicitly.
 */
describe("mediaServer request authentication", () => {
	let tempRoot: string;
	let mediaFile: string;
	let mediaBytes: Buffer;
	let baseUrl: string;

	beforeEach(async () => {
		tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "morec-media-server-sec-"));
		mediaBytes = Buffer.from("approved-media-fixture-bytes");
		mediaFile = path.join(tempRoot, "clip.mp4");
		await fs.writeFile(mediaFile, mediaBytes);
		approvedLocalReadPaths.add(await fs.realpath(mediaFile));
		baseUrl = await ensureMediaServer();
	});

	afterEach(async () => {
		await closeMediaServer();
		approvedLocalReadPaths.clear();
		await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => undefined);
	});

	function videoUrl(): string {
		return buildMediaUrl(baseUrl, mediaFile);
	}

	function expectedHost(): string {
		return new URL(baseUrl).host;
	}

	function urlWithoutToken(url: string): string {
		const parsed = new URL(url);
		parsed.searchParams.delete("k");
		return parsed.toString();
	}

	function rawRequest(
		target: URL,
		headers: Record<string, string>,
	): Promise<{ status: number; body: Buffer }> {
		return new Promise((resolve, reject) => {
			const request = http.request(
				{
					hostname: target.hostname,
					port: target.port,
					path: `${target.pathname}${target.search}`,
					method: "GET",
					headers,
				},
				(response) => {
					const chunks: Buffer[] = [];
					response.on("data", (chunk: Buffer) => chunks.push(chunk));
					response.on("end", () => {
						resolve({
							status: response.statusCode ?? 0,
							body: Buffer.concat(chunks),
						});
					});
				},
			);
			request.on("error", reject);
			request.end();
		});
	}

	it("serves an approved file for the correct Host and capability token", async () => {
		const response = await rawRequest(new URL(videoUrl()), { Host: expectedHost() });

		expect(response.status).toBe(200);
		expect(response.body).toEqual(mediaBytes);
	});

	it("rejects requests without the capability token", async () => {
		const response = await rawRequest(new URL(urlWithoutToken(videoUrl())), {
			Host: expectedHost(),
		});

		expect(response.status).toBe(403);
	});

	it("rejects requests with a wrong capability token", async () => {
		const spoofed = new URL(videoUrl());
		spoofed.searchParams.set("k", "tampered-token");
		const response = await rawRequest(spoofed, { Host: expectedHost() });

		expect(response.status).toBe(403);
	});

	it("rejects foreign Host headers even with a valid token", async () => {
		const response = await rawRequest(new URL(videoUrl()), { Host: "evil.com" });

		expect(response.status).toBe(403);
	});

	it("rejects Host headers with the wrong port", async () => {
		const response = await rawRequest(new URL(videoUrl()), { Host: "127.0.0.1:1" });

		expect(response.status).toBe(403);
	});

	it("embeds a stable per-session capability token in buildMediaUrl output", () => {
		const first = videoUrl();
		const second = videoUrl();

		expect(second).toBe(first);
		const token = new URL(first).searchParams.get("k");
		// randomBytes(32).toString("base64url") is always 43 URL-safe characters.
		expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
	});

	it("rotates the token when the server restarts", async () => {
		const oldToken = new URL(videoUrl()).searchParams.get("k");

		await closeMediaServer();
		baseUrl = await ensureMediaServer();

		// Replay the old token against the fresh server instance.
		const replay = new URL("/video", baseUrl);
		replay.searchParams.set("path", path.resolve(mediaFile));
		replay.searchParams.set("k", oldToken ?? "");
		const rejected = await rawRequest(replay, { Host: expectedHost() });
		expect(rejected.status).toBe(403);

		// The fresh instance's own URL is served.
		const accepted = await rawRequest(new URL(videoUrl()), { Host: expectedHost() });
		expect(accepted.status).toBe(200);
		expect(Buffer.from(await fs.readFile(mediaFile))).toEqual(accepted.body);
	});
});
