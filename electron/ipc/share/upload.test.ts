import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sha256Hex } from "./sigv4";

/**
 * Unit tests for the share upload module: https enforcement, typed error
 * codes, credential redaction, streamed-progress throttling, and the
 * happy-path signed PUT (with a mocked global fetch — no network).
 */

const settingsStore = vi.hoisted(() => new Map<string, unknown>());
const approvedPaths = vi.hoisted(() => new Set<string>());
const secretHolder = vi.hoisted(() => ({ value: undefined as string | undefined }));
const clipboardMock = vi.hoisted(() => ({ writeText: vi.fn() }));

vi.doMock("electron", () => ({ clipboard: clipboardMock }));
vi.doMock("../register/settings", () => ({
	readAppSettingValue: (key: string) => settingsStore.get(key),
}));
// Mirrors the real redaction algorithm so redaction behavior is exercised.
vi.doMock("../ai/credentials", () => ({
	SHARE_CREDENTIALS_STORE_KEY: "shareCredentials",
	loadSecret: () => {
		if (secretHolder.value === undefined) {
			throw new Error("no secret stored");
		}
		return secretHolder.value;
	},
	redactCredentials: (message: string, secrets: Array<string | undefined | null>) => {
		let redacted = message;
		for (const secret of secrets) {
			if (!secret || secret.length < 4) continue;
			redacted = redacted.split(secret).join("[redacted]");
		}
		return redacted;
	},
}));
vi.doMock("../utils", () => ({
	normalizeVideoSourcePath: (value: unknown) =>
		typeof value === "string" ? value : null,
}));
vi.doMock("../state", () => ({ approvedLocalReadPaths: approvedPaths }));

const SECRET = ["test", "secret", "material"].join("-");

function configureValidSharing() {
	settingsStore.set("sharingEndpoint", "https://s3.example.test");
	settingsStore.set("sharingRegion", "us-east-1");
	settingsStore.set("sharingBucket", "demo-bucket");
	settingsStore.set("sharingAccessKey", "AKIDTESTKEY");
	settingsStore.set("sharingPublicBaseUrl", "https://cdn.example.com/recordings/");
	settingsStore.set("sharingKeyPrefix", "morec/");
	secretHolder.value = SECRET;
}

describe("readShareConfig", () => {
	let upload: typeof import("./upload");

	beforeEach(async () => {
		vi.resetModules();
		settingsStore.clear();
		secretHolder.value = undefined;
		upload = await import("./upload");
	});

	it("reports not-configured when settings are missing", () => {
		const config = upload.readShareConfig();
		expect("error" in config && config.error).toBe("not-configured");
	});

	it("rejects http:// endpoints as invalid (TLS only)", () => {
		settingsStore.set("sharingEndpoint", "http://s3.example.test");
		settingsStore.set("sharingBucket", "demo-bucket");
		settingsStore.set("sharingAccessKey", "AKIDTESTKEY");
		settingsStore.set("sharingPublicBaseUrl", "https://cdn.example.com/");
		const config = upload.readShareConfig();
		expect("error" in config && config.error).toBe("invalid-endpoint");
	});

	it("rejects endpoints with embedded credentials", () => {
		settingsStore.set("sharingEndpoint", "https://user:pass@s3.example.test");
		settingsStore.set("sharingBucket", "demo-bucket");
		settingsStore.set("sharingAccessKey", "AKIDTESTKEY");
		settingsStore.set("sharingPublicBaseUrl", "https://cdn.example.com/");
		const config = upload.readShareConfig();
		expect("error" in config && config.error).toBe("invalid-endpoint");
	});

	it("parses a valid https config with defaults", () => {
		configureValidSharing();
		const config = upload.readShareConfig();
		expect("error" in config).toBe(false);
		if (!("error" in config)) {
			expect(config.endpointUrl.protocol).toBe("https:");
			expect(config.region).toBe("us-east-1");
			expect(config.bucket).toBe("demo-bucket");
			expect(config.keyPrefix).toBe("morec/");
		}
	});
});

describe("createProgressTrackingStream", () => {
	let upload: typeof import("./upload");

	beforeEach(async () => {
		vi.resetModules();
		upload = await import("./upload");
	});

	it("emits at most one event per 250 ms and a final 100% event", async () => {
		vi.useFakeTimers();
		const start = 1_000_000;
		vi.setSystemTime(start);
		const events: Array<{ bytesSent: number; percent: number }> = [];
		const stream = upload.createProgressTrackingStream(1000, (progress) =>
			events.push({ bytesSent: progress.bytesSent, percent: progress.percent }),
		);

		const write = (chunk: Buffer) =>
			new Promise<void>((resolve) => stream.write(chunk, () => resolve()));
		await write(Buffer.alloc(400, 1));
		vi.setSystemTime(start + 100);
		await write(Buffer.alloc(300, 1)); // suppressed: only 100 ms elapsed
		vi.setSystemTime(start + 400);
		await write(Buffer.alloc(300, 1)); // emitted: 400 ms since last emit

		await new Promise<void>((resolve) => stream.end(() => resolve()));

		expect(events.map((event) => event.bytesSent)).toEqual([400, 1000, 1000]);
		expect(events[events.length - 1].percent).toBe(100);
		vi.useRealTimers();
	});
});

describe("shareUploadRecording", () => {
	let upload: typeof import("./upload");
	let tempRoot: string;
	let filePath: string;

	const fetchMock = vi.spyOn(globalThis, "fetch");

	beforeEach(async () => {
		vi.resetModules();
		settingsStore.clear();
		approvedPaths.clear();
		secretHolder.value = undefined;
		upload = await import("./upload");
		tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "morec-share-test-"));
		filePath = path.join(tempRoot, "demo rec.mp4");
		await fs.writeFile(filePath, "recording-bytes", "utf-8");
		fetchMock.mockReset();
	});

	afterEach(async () => {
		await fs.rm(tempRoot, { recursive: true, force: true });
	});

	it("answers file-not-approved for paths that were never opened or saved", async () => {
		configureValidSharing();
		const result = await upload.shareUploadRecording({ filePath });
		expect(result).toMatchObject({ success: false, errorCode: "file-not-approved" });
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("PUTs the approved file signed and copies the public URL", async () => {
		configureValidSharing();
		approvedPaths.add(path.resolve(filePath));
		fetchMock.mockResolvedValue(new Response(null, { status: 200 }));

		const result = await upload.shareUploadRecording({ filePath });
		expect(result).toMatchObject({
			success: true,
			url: "https://cdn.example.com/recordings/demo%20rec.mp4",
			bytesSent: "recording-bytes".length,
		});
		expect(clipboardMock.writeText).toHaveBeenCalledWith(
			"https://cdn.example.com/recordings/demo%20rec.mp4",
		);

		expect(fetchMock).toHaveBeenCalledTimes(1);
		const [url, init] = fetchMock.mock.calls[0] as unknown as [
			URL,
			RequestInit & { headers: Record<string, string> },
		];
		expect(String(url)).toBe("https://s3.example.test/");
		expect(init.method).toBe("PUT");
		expect(init.headers["x-amz-content-sha256"]).toBe(sha256Hex("recording-bytes"));
		expect(init.headers["Content-Length"]).toBe(String("recording-bytes".length));
		expect(init.headers["Authorization"]).toContain("Credential=AKIDTESTKEY/");
		expect(init.headers["Authorization"]).toContain("SignedHeaders=host;x-amz-content-sha256;x-amz-date");
		expect(init.headers["Authorization"]).not.toContain(SECRET);
	});

	it("maps 403 to a typed credentials error without leaking the secret", async () => {
		configureValidSharing();
		approvedPaths.add(path.resolve(filePath));
		fetchMock.mockResolvedValue(new Response(`denied ${SECRET}`, { status: 403 }));

		const result = await upload.shareUploadRecording({ filePath });
		expect(result).toMatchObject({ success: false, errorCode: "credentials-rejected" });
		if (!result.success) {
			expect(result.message).toContain("403");
			expect(result.message).not.toContain(SECRET);
		}
	});

	it("maps 404 to a typed bucket/endpoint error", async () => {
		configureValidSharing();
		approvedPaths.add(path.resolve(filePath));
		fetchMock.mockResolvedValue(new Response("no such bucket", { status: 404 }));

		const result = await upload.shareUploadRecording({ filePath });
		expect(result).toMatchObject({ success: false, errorCode: "bucket-not-found" });
	});

	it("redacts credential material from network error messages", async () => {
		configureValidSharing();
		approvedPaths.add(path.resolve(filePath));
		fetchMock.mockRejectedValue(new Error(`getaddrinfo failed for ${SECRET}`));

		const result = await upload.shareUploadRecording({ filePath });
		expect(result).toMatchObject({ success: false, errorCode: "network" });
		if (!result.success) {
			expect(result.message).toContain("[redacted]");
			expect(result.message).not.toContain(SECRET);
		}
	});
});
