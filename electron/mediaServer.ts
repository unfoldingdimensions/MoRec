import { randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";
import { approvedLocalReadPaths } from "./ipc/state";
import { getMediaContentType } from "./mediaTypes";

let mediaServerBaseUrl: string | null = null;
let mediaServerBoundPort: number | null = null;
// Per-session capability token. The bound port is trivially enumerable for any
// local process, so this unguessable `k` query parameter is what actually gates
// access to approved media.
let mediaServerAccessToken: string | null = null;
let mediaServerStartPromise: Promise<string> | null = null;
let mediaServerInstance: ReturnType<typeof createServer> | null = null;

export function resolveHttpByteRange(
	rangeHeader: string,
	fileSize: number,
): { start: number; end: number } | null {
	const match = rangeHeader.trim().match(/^bytes=(\d*)-(\d*)$/);
	if (!match || (!match[1] && !match[2])) {
		return null;
	}

	if (fileSize === 0) {
		return null;
	}

	if (!match[1] && match[2]) {
		// Suffix range: bytes=-500
		const suffixLength = Number.parseInt(match[2], 10);
		if (Number.isNaN(suffixLength) || suffixLength <= 0) {
			return null;
		}

		return {
			start: Math.max(0, fileSize - suffixLength),
			end: fileSize - 1,
		};
	}

	const start = Number.parseInt(match[1], 10);
	if (Number.isNaN(start) || start < 0 || start >= fileSize) {
		return null;
	}

	const requestedEnd = match[2] ? Number.parseInt(match[2], 10) : fileSize - 1;
	if (Number.isNaN(requestedEnd) || requestedEnd < start) {
		return null;
	}

	return {
		start,
		end: Math.min(requestedEnd, fileSize - 1),
	};
}

async function resolveRealPath(filePath: string): Promise<string | null> {
	try {
		return await fs.realpath(path.resolve(filePath));
	} catch {
		return null;
	}
}

export function isAllowedMediaPath(realPath: string): boolean {
	return approvedLocalReadPaths.has(realPath);
}

/**
 * Only reflect loopback renderer origins. A wildcard policy previously let any
 * webpage open in the user's browser read responses from this localhost server
 * (recording paths are predictable), exfiltrating approved media cross-origin.
 */
function resolveAllowedCorsOrigin(request: IncomingMessage): string | undefined {
	const origin = request.headers.origin;
	if (typeof origin !== "string" || origin.length === 0) {
		return undefined;
	}
	try {
		const parsed = new URL(origin);
		const host = parsed.hostname;
		const isLoopback = host === "localhost" || host === "127.0.0.1" || host === "[::1]";
		if (parsed.protocol === "http:" && isLoopback) {
			return origin;
		}
	} catch {
		// Malformed origin: treat as absent.
	}
	return undefined;
}

/**
 * DNS-rebinding defense: a page on an attacker-controlled domain that resolves
 * to 127.0.0.1 would send same-origin requests (CORS no longer applies), so the
 * Host header must name this exact loopback endpoint, not a rebinding domain.
 */
function isTrustedMediaHost(hostHeader: string | undefined): boolean {
	if (!hostHeader || mediaServerBoundPort === null) {
		return false;
	}
	const separatorIndex = hostHeader.lastIndexOf(":");
	const hostPart =
		separatorIndex === -1 ? hostHeader : hostHeader.slice(0, separatorIndex);
	const portPart =
		separatorIndex === -1 ? "" : hostHeader.slice(separatorIndex + 1);
	return (
		hostPart.toLowerCase() === "127.0.0.1" &&
		portPart === String(mediaServerBoundPort)
	);
}

async function handleMediaRequest(
	request: IncomingMessage,
	response: ServerResponse,
): Promise<void> {
	try {
		if (!isTrustedMediaHost(request.headers.host)) {
			response.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
			response.end("Forbidden");
			return;
		}

		const url = new URL(request.url ?? "/", "http://127.0.0.1");

		if (url.pathname !== "/video") {
			response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
			response.end("Not Found");
			return;
		}

		if (!mediaServerAccessToken || url.searchParams.get("k") !== mediaServerAccessToken) {
			response.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
			response.end("Forbidden");
			return;
		}

		const rawPath = url.searchParams.get("path");
		if (!rawPath) {
			response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
			response.end("Missing path parameter");
			return;
		}

		const resolvedPath = await resolveRealPath(rawPath);
		if (!resolvedPath || !isAllowedMediaPath(resolvedPath)) {
			console.warn(`[media-server] Blocked access to unapproved path: ${rawPath}`);
			response.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
			response.end("Forbidden");
			return;
		}

		const stat = await fs.stat(resolvedPath);
		if (!stat.isFile()) {
			response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
			response.end("Not Found");
			return;
		}

		const contentType = getMediaContentType(resolvedPath);
		const fileSize = stat.size;
		const rangeHeader = request.headers.range;

		const allowedOrigin = resolveAllowedCorsOrigin(request);
		const corsHeaders: Record<string, string> = {
			"Access-Control-Allow-Credentials": "false",
			"Access-Control-Expose-Headers": "Content-Range, Content-Length, Accept-Ranges",
		};
		if (allowedOrigin) {
			corsHeaders["Access-Control-Allow-Origin"] = allowedOrigin;
		}

		if (request.method === "OPTIONS") {
			response.writeHead(204, {
				...corsHeaders,
				"Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
				"Access-Control-Allow-Headers": "Range",
			});
			response.end();
			return;
		}

		if (rangeHeader) {
			if (fileSize === 0) {
				response.writeHead(416, { ...corsHeaders, "Content-Range": `bytes */0` });
				response.end();
				return;
			}

			const byteRange = resolveHttpByteRange(rangeHeader, fileSize);
			if (!byteRange) {
				response.writeHead(416, { ...corsHeaders, "Content-Range": `bytes */${fileSize}` });
				response.end();
				return;
			}

			const { start, end } = byteRange;

			const chunkSize = end - start + 1;
			response.writeHead(206, {
				...corsHeaders,
				"Content-Range": `bytes ${start}-${end}/${fileSize}`,
				"Accept-Ranges": "bytes",
				"Content-Length": String(chunkSize),
				"Content-Type": contentType,
				"Cache-Control": "no-cache",
			});

			if (request.method === "HEAD") {
				response.end();
				return;
			}

			const stream = createReadStream(resolvedPath, { start, end });
			stream.pipe(response);
			stream.on("error", () => {
				if (!response.headersSent) {
					response.writeHead(500, { "Content-Type": "text/plain" });
				}
				response.end();
			});
		} else {
			response.writeHead(200, {
				...corsHeaders,
				"Accept-Ranges": "bytes",
				"Content-Length": String(fileSize),
				"Content-Type": contentType,
				"Cache-Control": "no-cache",
			});

			if (request.method === "HEAD") {
				response.end();
				return;
			}

			const stream = createReadStream(resolvedPath);
			stream.pipe(response);
			stream.on("error", () => {
				if (!response.headersSent) {
					response.writeHead(500, { "Content-Type": "text/plain" });
				}
				response.end();
			});
		}
	} catch (error) {
		if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
			response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
			response.end("Not Found");
			return;
		}

		console.error("[media-server] Error handling request:", error);
		response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
		response.end("Internal Server Error");
	}
}

export function getMediaServerBaseUrl(): string | null {
	return mediaServerBaseUrl;
}

export async function ensureMediaServer(): Promise<string> {
	if (mediaServerBaseUrl) {
		return mediaServerBaseUrl;
	}

	if (mediaServerStartPromise) {
		return mediaServerStartPromise;
	}

	mediaServerStartPromise = new Promise((resolve, reject) => {
		const server = createServer((request, response) => {
			void handleMediaRequest(request, response);
		});

		server.once("error", (error) => {
			// Clear the cached rejection so a later call retries the bind
			// instead of failing media playback for the whole session.
			mediaServerStartPromise = null;
			reject(error);
		});

		mediaServerInstance = server;

		server.listen(0, "127.0.0.1", () => {
			const address = server.address();
			if (!address || typeof address === "string") {
				server.close();
				reject(new Error("Media server did not expose a TCP address"));
				return;
			}

			mediaServerBoundPort = address.port;
			mediaServerAccessToken = randomBytes(32).toString("base64url");
			mediaServerBaseUrl = `http://127.0.0.1:${address.port}`;
			console.log(`[media-server] Listening at ${mediaServerBaseUrl}`);
			resolve(mediaServerBaseUrl);
		});
	});

	return mediaServerStartPromise;
}

/**
 * Stop the running server and reset cached state. Intended for tests that
 * start/stop the server around assertions.
 */
export async function closeMediaServer(): Promise<void> {
	const instance = mediaServerInstance;
	mediaServerInstance = null;
	mediaServerBaseUrl = null;
	mediaServerBoundPort = null;
	mediaServerAccessToken = null;
	mediaServerStartPromise = null;
	if (instance) {
		await new Promise<void>((resolve) => instance.close(() => resolve()));
	}
}

export function buildMediaUrl(baseUrl: string, filePath: string): string {
	const url = new URL("/video", baseUrl);
	url.searchParams.set("path", path.resolve(filePath));
	if (mediaServerAccessToken) {
		url.searchParams.set("k", mediaServerAccessToken);
	}
	return url.toString();
}
