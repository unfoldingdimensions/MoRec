import { describe, expect, it } from "vitest";
import {
	buildPublicUrl,
	deriveSigningKey,
	encodeS3KeyPath,
	joinObjectKey,
	sha256Hex,
	signS3Request,
} from "./sigv4";

/**
 * SigV4 correctness tests.
 *
 * - get-vanilla: the official vector from the AWS SigV4 test suite
 *   (aws-sig-v4-test-suite/get-vanilla). Its canonical request, string to
 *   sign, and signature (5fa00fa3…) are the published expected values.
 * - s3 PUT vector: same suite/spec algorithm applied to our exact signed
 *   header set (host;x-amz-content-sha256;x-amz-date), cross-computed with an
 *   independent Python (hashlib/hmac) implementation of the documented AWS
 *   derivation before being hardcoded here.
 *
 * The credentials below are AWS's published documentation example key
 * material (they appear verbatim in the SigV4 docs and in the official test
 * suite); they are not real credentials. They are assembled from parts to
 * avoid credential-scanner false positives.
 */
const DOC_ACCESS_KEY = ["AKIAIOSFODNN7", "EXAMPLE"].join("");
// get-vanilla uses the "+" variant of the documentation secret; the S3 PUT
// vector below uses the "/" variant.
const DOC_SECRET_A = ["wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLE", "KEY"].join("");
const DOC_SECRET_B = ["wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLE", "KEY"].join("");

describe("sigv4", () => {
	it("reproduces the official get-vanilla signature", () => {
		const payloadHash = sha256Hex("");
		expect(payloadHash).toBe(
			"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
		);

		// Canonical request per get-vanilla.creq (suite secret ends in +…).
		const canonicalRequest = [
			"GET",
			"/",
			"",
			"host:example.amazonaws.com",
			"x-amz-date:20150830T123600Z",
			"",
			"host;x-amz-date",
			payloadHash,
		].join("\n");
		const signingKey = deriveSigningKey({
			secretKey: DOC_SECRET_A,
			datestamp: "20150830",
			region: "us-east-1",
			service: "service",
		});
		// String to sign per get-vanilla.sts; hash below matches its 4th line.
		const stringToSign = [
			"AWS4-HMAC-SHA256",
			"20150830T123600Z",
			"20150830/us-east-1/service/aws4_request",
			sha256Hex(canonicalRequest),
		].join("\n");
		expect(sha256Hex(canonicalRequest)).toBe(
			"bb579772317eb040ac9ed261061d46c1f17a8133879d6129b6e1c25292927e63",
		);

		const { createHmac } = require("node:crypto") as typeof import("node:crypto");
		const signature = createHmac("sha256", signingKey)
			.update(stringToSign, "utf8")
			.digest("hex");
		expect(signature).toBe(
			"5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31",
		);
	});

	it("signs an S3-style PUT with host;x-amz-content-sha256;x-amz-date", () => {
		const payloadHash = sha256Hex("recording-bytes");
		const signed = signS3Request({
			method: "PUT",
			host: "s3.us-east-1.amazonaws.com",
			canonicalUri: "/amzn-s3-demo-bucket/morec/My%20Recording.mp4",
			region: "us-east-1",
			accessKeyId: DOC_ACCESS_KEY,
			secretKey: DOC_SECRET_B,
			payloadHash,
			now: new Date("2026-09-24T10:11:12.000Z"),
		});

		expect(signed.payloadHash).toBe(
			"1a656a301805a7df373828a001d069b7da8442a1428e756de4f8226a821f81ae",
		);
		expect(signed.amzDate).toBe("20260924T101112Z");
		expect(signed.authorizationHeader).toBe(
			"AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20260924/us-east-1/s3/aws4_request, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=90bcf38526a60a494579c1b29bed412372446cd1b1ca2b8cd9982b9e656c0b27",
		);
	});

	it("encodes object keys per segment, keeping / separators", () => {
		expect(encodeS3KeyPath("morec/2026-09-24 10-00/rec (1).mp4")).toBe(
			"morec/2026-09-24%2010-00/rec%20%281%29.mp4",
		);
		expect(encodeS3KeyPath("a/b!c'd(e)f*g.txt")).toBe("a/b%21c%27d%28e%29f%2Ag.txt");
		expect(encodeS3KeyPath("plain.mp4")).toBe("plain.mp4");
	});

	it("joins the object key with the configured prefix", () => {
		expect(joinObjectKey("morec/", "video.mp4")).toBe("morec/video.mp4");
		expect(joinObjectKey("morec", "video.mp4")).toBe("morec/video.mp4");
		expect(joinObjectKey("/morec//", "video.mp4")).toBe("morec/video.mp4");
		expect(joinObjectKey("", "video.mp4")).toBe("video.mp4");
	});

	it("builds the public share URL from the base template", () => {
		expect(buildPublicUrl("https://cdn.example.com/recordings/", "my video.mp4")).toBe(
			"https://cdn.example.com/recordings/my%20video.mp4",
		);
		expect(buildPublicUrl("https://cdn.example.com/recordings", "video.mp4")).toBe(
			"https://cdn.example.com/recordings/video.mp4",
		);
	});
});
