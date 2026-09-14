import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeMediaServer, ensureMediaServer } from "./mediaServer";
import { approvedLocalReadPaths } from "./ipc/state";

/**
 * Live integration tests: start the real localhost media server and issue
 * actual HTTP requests against its path policy, byte ranges, and CORS rules.
 */
describe("mediaServer (live HTTP)", () => {
	let tempRoot: string;
	let mediaFile: string;
	let mediaBytes: Buffer;

	beforeEach(async () => {
		tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "morec-media-server-test-"));
		mediaBytes = Buffer.concat(
			[Buffer.from("0123456789"), Buffer.alloc(1014, 0x61), Buffer.from("xyz")],
		);
		mediaFile = path.join(tempRoot, "clip.mp4");
		await fs.writeFile(mediaFile, mediaBytes);
		approvedLocalReadPaths.add(await fs.realpath(mediaFile));
	});

	afterEach(async () => {
		await closeMediaServer();
		approvedLocalReadPaths.clear();
		await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => undefined);
	});

	async function getVideoUrl() {
		const base = await ensureMediaServer();
		return `${base}/video?path=${encodeURIComponent(mediaFile)}`;
	}

	it("serves an approved file over HTTP", async () => {
		const response = await fetch(await getVideoUrl());

		expect(response.status).toBe(200);
		expect(response.headers.get("accept-ranges")).toBe("bytes");
		expect(Buffer.from(await response.arrayBuffer())).toEqual(mediaBytes);
	});

	it("returns 404 for unknown routes and 400 for missing path", async () => {
		const base = await ensureMediaServer();

		expect((await fetch(`${base}/other`)).status).toBe(404);
		expect((await fetch(`${base}/video`)).status).toBe(400);
	});

	it("returns 403 for paths that are not approved", async () => {
		const base = await ensureMediaServer();
		const unapproved = path.join(tempRoot, "secret.txt");
		await fs.writeFile(unapproved, "nope");

		const response = await fetch(`${base}/video?path=${encodeURIComponent(unapproved)}`);
		expect(response.status).toBe(403);
	});

	it("serves partial content for byte ranges", async () => {
		const response = await fetch(await getVideoUrl(), {
			headers: { Range: "bytes=0-9" },
		});

		expect(response.status).toBe(206);
		expect(response.headers.get("content-range")).toBe(`bytes 0-9/${mediaBytes.length}`);
		expect(Buffer.from(await response.arrayBuffer())).toEqual(
			mediaBytes.subarray(0, 10),
		);
	});

	it("serves a suffix range from the end of the file", async () => {
		const response = await fetch(await getVideoUrl(), {
			headers: { Range: "bytes=-3" },
		});

		expect(response.status).toBe(206);
		expect(Buffer.from(await response.arrayBuffer())).toEqual(
			mediaBytes.subarray(mediaBytes.length - 3),
		);
	});

	it("reflects loopback origins and ignores foreign ones", async () => {
		const url = await getVideoUrl();

		const loopback = await fetch(url, { headers: { Origin: "http://localhost:5173" } });
		expect(loopback.headers.get("access-control-allow-origin")).toBe(
			"http://localhost:5173",
		);

		const foreign = await fetch(url, { headers: { Origin: "https://evil.example" } });
		expect(foreign.headers.get("access-control-allow-origin")).toBeNull();

		const noOrigin = await fetch(url);
		expect(noOrigin.headers.get("access-control-allow-origin")).toBeNull();
	});

	it("answers CORS preflight requests for loopback origins", async () => {
		const url = await getVideoUrl();
		const response = await fetch(url, {
			method: "OPTIONS",
			headers: { Origin: "http://localhost:5173" },
		});

		expect(response.status).toBe(204);
		expect(response.headers.get("access-control-allow-origin")).toBe(
			"http://localhost:5173",
		);
		expect(response.headers.get("access-control-allow-methods")).toContain("GET");
	});
});
