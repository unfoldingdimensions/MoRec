import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import { Readable, Transform } from "node:stream";
import { clipboard } from "electron";
import { normalizeVideoSourcePath } from "../utils";
import { approvedLocalReadPaths } from "../state";
import {
	SHARE_CREDENTIALS_STORE_KEY,
	loadSecret,
	redactCredentials,
} from "../ai/credentials";
import { readAppSettingValue } from "../register/settings";
import {
	buildPublicUrl,
	encodeS3KeyPath,
	joinObjectKey,
	signS3Request,
} from "./sigv4";

/**
 * BYO S3-compatible upload: single PUT of an exported recording to
 * <endpoint>/<bucket>/<prefix><fileName>, signed with AWS SigV4 over
 * node:crypto (see ./sigv4 — no SDK).
 *
 * The video is never read into memory: one streamed SHA-256 pass produces the
 * payload hash the signature needs, then a second streamed pass is the PUT
 * body. Upload progress is reported through a throttled callback (250 ms) so
 * the renderer receives a bounded number of IPC events.
 *
 * Endpoints are TLS-only: an http:// endpoint is rejected before any request
 * is made. Error messages are typed and never contain credential material —
 * every message passes through redaction against the access key and secret.
 */

export const DEFAULT_SHARE_KEY_PREFIX = "morec/";
const PROGRESS_THROTTLE_MS = 250;

export type ShareUploadErrorCode =
	| "not-configured"
	| "invalid-endpoint"
	| "encrypt-unavailable"
	| "file-not-found"
	| "file-not-approved"
	| "credentials-rejected"
	| "bucket-not-found"
	| "network"
	| "http";

export interface ShareUploadProgress {
	bytesSent: number;
	totalBytes: number;
	percent: number;
}

export type ShareUploadResult =
	| { success: true; url: string; bytesSent: number }
	| { success: false; errorCode: ShareUploadErrorCode; message: string };

type FetchLike = typeof fetch;

interface ShareConfig {
	endpointUrl: URL;
	region: string;
	bucket: string;
	accessKeyId: string;
	secretKey: string;
	keyPrefix: string;
	publicBaseUrl: string;
}

export function readShareConfig(): ShareConfig | { error: ShareUploadErrorCode; message: string } {
	const endpointRaw =
		typeof readAppSettingValue("sharingEndpoint") === "string"
			? (readAppSettingValue("sharingEndpoint") as string).trim()
			: "";
	const bucket =
		typeof readAppSettingValue("sharingBucket") === "string"
			? (readAppSettingValue("sharingBucket") as string).trim()
			: "";
	const accessKeyId =
		typeof readAppSettingValue("sharingAccessKey") === "string"
			? (readAppSettingValue("sharingAccessKey") as string).trim()
			: "";
	const region =
		typeof readAppSettingValue("sharingRegion") === "string" &&
		(readAppSettingValue("sharingRegion") as string).trim()
			? (readAppSettingValue("sharingRegion") as string).trim()
			: "us-east-1";
	const publicBaseUrl =
		typeof readAppSettingValue("sharingPublicBaseUrl") === "string"
			? (readAppSettingValue("sharingPublicBaseUrl") as string).trim()
			: "";
	const keyPrefix =
		typeof readAppSettingValue("sharingKeyPrefix") === "string"
			? (readAppSettingValue("sharingKeyPrefix") as string)
			: DEFAULT_SHARE_KEY_PREFIX;

	if (!endpointRaw || !bucket || !accessKeyId || !publicBaseUrl) {
		return {
			error: "not-configured",
			message: "Sharing is not configured. Add your S3-compatible endpoint, bucket, and keys in Settings.",
		};
	}

	let endpointUrl: URL;
	try {
		endpointUrl = new URL(endpointRaw);
	} catch {
		return {
			error: "invalid-endpoint",
			message: "The sharing endpoint is not a valid URL.",
		};
	}
	// TLS only. The scheme check plus hostname sanity covers malformed inputs;
	// the endpoint is the user's own S3-compatible host, so private LAN
	// addresses stay allowed (self-hosted MinIO/Garage are legitimate BYO
	// targets) — only cleartext HTTP is rejected.
	if (
		endpointUrl.protocol !== "https:" ||
		!endpointUrl.hostname ||
		endpointUrl.username ||
		endpointUrl.password
	) {
		return {
			error: "invalid-endpoint",
			message: "The sharing endpoint must be an https:// URL without embedded credentials.",
		};
	}

	let secretKey: string;
	try {
		secretKey = loadSecret(SHARE_CREDENTIALS_STORE_KEY);
	} catch {
		return {
			error: "not-configured",
			message: "No secret key is stored. Save your S3 secret key in Settings first.",
		};
	}

	return {
		endpointUrl,
		region,
		bucket,
		accessKeyId,
		secretKey,
		keyPrefix: keyPrefix || DEFAULT_SHARE_KEY_PREFIX,
		publicBaseUrl,
	};
}

/** Streamed SHA-256 of the file (never a full-file readFile). */
export async function hashFileStreaming(filePath: string): Promise<string> {
	const hash = createHash("sha256");
	const stream = createReadStream(filePath, { highWaterMark: 1024 * 1024 });
	for await (const chunk of stream) {
		hash.update(chunk as Buffer);
	}
	return hash.digest("hex");
}

export function createProgressTrackingStream(
	totalBytes: number,
	onProgress: (progress: ShareUploadProgress) => void,
): Transform {
	let bytesSent = 0;
	let lastEmitMs = 0;
	const emit = (force = false) => {
		const now = Date.now();
		if (!force && now - lastEmitMs < PROGRESS_THROTTLE_MS) {
			return;
		}
		lastEmitMs = now;
		onProgress({
			bytesSent,
			totalBytes,
			percent: totalBytes > 0 ? Math.min(100, Math.round((bytesSent / totalBytes) * 100)) : 100,
		});
	};

	return new Transform({
		transform(chunk: Buffer, _encoding, callback) {
			bytesSent += chunk.byteLength;
			emit();
			callback(null, chunk);
		},
		flush(callback) {
			emit(true);
			callback();
		},
	});
}

export async function shareUploadRecording(options: {
	filePath: string;
	onProgress?: (progress: ShareUploadProgress) => void;
	fetchImpl?: FetchLike;
	now?: Date;
}): Promise<ShareUploadResult> {
	const config = readShareConfig();
	if ("error" in config) {
		return { success: false, errorCode: config.error, message: config.message };
	}

	const filePath = normalizeVideoSourcePath(options.filePath);
	if (!filePath) {
		return {
			success: false,
			errorCode: "file-not-found",
			message: "No exported file was provided to upload.",
		};
	}

	// Read consent mirrors approveUserPath's dual spelling (lexical + realpath)
	// so an exported file approved by the save dialog uploads on either branch.
	let resolved: string | null = approvedLocalReadPaths.has(filePath) ? filePath : null;
	if (!resolved) {
		try {
			const real = realpathSync(filePath);
			resolved = approvedLocalReadPaths.has(real) ? real : null;
		} catch {
			resolved = null;
		}
	}
	if (!resolved) {
		return {
			success: false,
			errorCode: "file-not-approved",
			message: "This file has not been opened or saved through Mo Rec, so it cannot be uploaded.",
		};
	}

	let totalBytes: number;
	try {
		const stat = await fs.stat(resolved);
		if (!stat.isFile()) {
			throw new Error("not a file");
		}
		totalBytes = stat.size;
	} catch {
		return {
			success: false,
			errorCode: "file-not-found",
			message: "The exported file could not be found on disk.",
		};
	}

	const fileName = filePath.split(/[\\/]/).pop() ?? "recording.mp4";
	const objectKey = joinObjectKey(config.keyPrefix, fileName);
	const canonicalUri = `/${encodeS3KeyPath(config.bucket)}/${encodeS3KeyPath(objectKey)}`;

	try {
		const payloadHash = await hashFileStreaming(resolved);
		const signed = signS3Request({
			method: "PUT",
			host: config.endpointUrl.host,
			canonicalUri,
			region: config.region,
			accessKeyId: config.accessKeyId,
			secretKey: config.secretKey,
			payloadHash,
			now: options.now,
		});

		const doFetch = options.fetchImpl ?? fetch;
		const fileStream = createReadStream(resolved, { highWaterMark: 1024 * 1024 });
		const body = options.onProgress
			? Readable.toWeb(
					fileStream.pipe(createProgressTrackingStream(totalBytes, options.onProgress)),
				)
			: Readable.toWeb(fileStream);

		const response = await doFetch(config.endpointUrl, {
			method: "PUT",
			headers: {
				Authorization: signed.authorizationHeader,
				"x-amz-date": signed.amzDate,
				"x-amz-content-sha256": signed.payloadHash,
				"Content-Length": String(totalBytes),
			},
			body: body as unknown as BodyInit,
			duplex: "half",
		} as RequestInit & { duplex: "half" });

		if (!response.ok) {
			const message = uploadHttpErrorMessage(response.status, config.accessKeyId, config.secretKey);
			return { success: false, errorCode: errorCodeForStatus(response.status), message };
		}

		// Drain the (small) response body so the socket completes cleanly.
		await response.arrayBuffer();

		const publicUrl = buildPublicUrl(config.publicBaseUrl, fileName);
		try {
			clipboard.writeText(publicUrl);
		} catch {
			// Clipboard is best-effort; the URL is still returned for display.
		}
		return { success: true, url: publicUrl, bytesSent: totalBytes };
	} catch (error) {
		const raw = error instanceof Error ? error.message : String(error);
		return {
			success: false,
			errorCode: "network",
			message: redactCredentials(
				`The upload could not reach the endpoint: ${raw}`,
				[config.accessKeyId, config.secretKey],
			),
		};
	}
}

function errorCodeForStatus(status: number): ShareUploadErrorCode {
	if (status === 403) {
		return "credentials-rejected";
	}
	if (status === 404) {
		return "bucket-not-found";
	}
	return "http";
}

function uploadHttpErrorMessage(
	status: number,
	accessKeyId: string,
	secretKey: string,
): string {
	let message: string;
	switch (status) {
		case 403:
			message =
				"The bucket rejected the upload credentials (403). Check the access key, secret key, and bucket permissions.";
			break;
		case 404:
			message =
				"The bucket or endpoint was not found (404). Check the bucket name and endpoint URL.";
			break;
		default:
			message = `The upload failed with HTTP status ${status}.`;
	}
	return redactCredentials(message, [accessKeyId, secretKey]);
}
