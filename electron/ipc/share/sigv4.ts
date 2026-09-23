import { createHash, createHmac } from "node:crypto";

/**
 * AWS Signature Version 4 for S3-compatible PUT uploads, implemented over
 * node:crypto — no SDK dependency.
 *
 * Canonical request layout (signed headers host;x-amz-content-sha256;x-amz-date):
 *
 *   PUT\n
 *   <canonicalUri>\n
 *   <canonicalQueryString>\n
 *   host:<host>\n
 *   x-amz-content-sha256:<payloadHash>\n
 *   x-amz-date:<amzDate>\n
 *   \n
 *   host;x-amz-content-sha256;x-amz-date\n
 *   <payloadHash>
 */

export const S3_UNSIGNED_PAYLOAD = "UNSIGNED-PAYLOAD";
export const EMPTY_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

export function sha256Hex(data: string | Buffer): string {
	return createHash("sha256").update(data).digest("hex");
}

export function hmacBinary(key: string | Buffer, data: string): Buffer {
	return createHmac("sha256", key).update(data, "utf8").digest();
}

export function deriveSigningKey(options: {
	secretKey: string;
	datestamp: string;
	region: string;
	service: string;
}): Buffer {
	const kDate = hmacBinary(`AWS4${options.secretKey}`, options.datestamp);
	const kRegion = hmacBinary(kDate, options.region);
	const kService = hmacBinary(kRegion, options.service);
	return hmacBinary(kService, "aws4_request");
}

export function buildCanonicalRequest(options: {
	method: string;
	canonicalUri: string;
	canonicalQueryString: string;
	headers: Record<string, string>;
	signedHeaders: string[];
	payloadHash: string;
}): string {
	const headerLines = options.signedHeaders
		.map((name) => `${name}:${options.headers[name].trim()}`)
		.join("\n");
	return [
		options.method,
		options.canonicalUri,
		options.canonicalQueryString,
		headerLines,
		"",
		options.signedHeaders.join(";"),
		options.payloadHash,
	].join("\n");
}

export function buildStringToSign(options: {
	amzDate: string;
	scope: string;
	canonicalRequest: string;
}): string {
	return [
		"AWS4-HMAC-SHA256",
		options.amzDate,
		options.scope,
		sha256Hex(options.canonicalRequest),
	].join("\n");
}

export interface SignedRequestParts {
	amzDate: string;
	authorizationHeader: string;
	payloadHash: string;
}

/**
 * Signs a PUT <canonicalUri> request. `now` is injectable for tests; in
 * production the caller passes a fresh Date. Header names must already be
 * lowercase; `host` is the endpoint authority without scheme/port-less.
 */
export function signS3Request(options: {
	method: "PUT";
	host: string;
	canonicalUri: string;
	region: string;
	accessKeyId: string;
	secretKey: string;
	payloadHash: string;
	now?: Date;
}): SignedRequestParts {
	const now = options.now ?? new Date();
	const amzDate = now
		.toISOString()
		.replace(/[-:]/g, "")
		.replace(/\.\d{3}Z$/, "Z");
	const datestamp = amzDate.slice(0, 8);
	const scope = `${datestamp}/${options.region}/s3/aws4_request`;

	const headers: Record<string, string> = {
		host: options.host,
		"x-amz-content-sha256": options.payloadHash,
		"x-amz-date": amzDate,
	};
	const signedHeaders = ["host", "x-amz-content-sha256", "x-amz-date"];

	const canonicalRequest = buildCanonicalRequest({
		method: options.method,
		canonicalUri: options.canonicalUri,
		canonicalQueryString: "",
		headers,
		signedHeaders,
		payloadHash: options.payloadHash,
	});
	const stringToSign = buildStringToSign({ amzDate, scope, canonicalRequest });
	const signingKey = deriveSigningKey({
		secretKey: options.secretKey,
		datestamp,
		region: options.region,
		service: "s3",
	});
	const signature = createHmac("sha256", signingKey).update(stringToSign, "utf8").digest("hex");

	return {
		amzDate,
		authorizationHeader: [
			`AWS4-HMAC-SHA256 Credential=${options.accessKeyId}/${scope}`,
			`SignedHeaders=${signedHeaders.join(";")}`,
			`Signature=${signature}`,
		].join(", "),
		payloadHash: options.payloadHash,
	};
}

/**
 * AWS strict URI encoding for object keys: each path segment gets
 * encodeURIComponent, then the characters it leaves bare that AWS requires
 * encoded (!, ', (, ), *) are percent-encoded too. "/" stays a separator.
 */
export function encodeS3KeyPath(key: string): string {
	return key
		.split("/")
		.map((segment) =>
			encodeURIComponent(segment).replace(
				/[!'()*]/g,
				(char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
			),
		)
		.join("/");
}

/** Join the public base-URL template and the file name into a shareable link. */
export function buildPublicUrl(publicBaseUrl: string, fileName: string): string {
	const base = publicBaseUrl.trim().replace(/\/+$/, "");
	return `${base}/${encodeURIComponent(fileName)}`;
}

export function joinObjectKey(prefix: string, fileName: string): string {
	const normalizedPrefix = prefix.trim().replace(/^\/+/, "").replace(/\/+$/, "");
	return normalizedPrefix ? `${normalizedPrefix}/${fileName}` : fileName;
}
