import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IpcRegistry } from "../test/ipcRegistry";

/**
 * Tests for the extension loader (manifest validation, install, discover,
 * status persistence, uninstall) and the marketplace's download validation
 * (origin allowlist and extension-id sanitization), using a real temp
 * userData directory.
 */
describe("extension loader + marketplace validation", () => {
	// The loader resolves its directories from app.getPath("userData"); point
	// it at a per-test temp directory via a closure over the mutable binding.
	const registry = new IpcRegistry({
		app: {
			getPath: (name: string) =>
				name === "userData" ? userDataDir : path.join(os.tmpdir(), "morec-test"),
		},
	});
	let userDataDir: string;

	function writeManifest(dir: string, manifest: unknown) {
		return fs.writeFile(
			path.join(dir, "morec-extension.json"),
			JSON.stringify(manifest, null, 2),
			"utf-8",
		);
	}

	beforeEach(async () => {
		vi.resetModules();
		registry.reset();
		userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "morec-extensions-test-"));
		registry.installElectronMock();
	});

	afterEach(async () => {
		vi.resetModules();
		vi.doUnmock("electron");
		await fs.rm(userDataDir, { recursive: true, force: true }).catch(() => undefined);
	});

	it("installs a valid extension from a directory", async () => {
		const source = path.join(userDataDir, "source", "my-ext");
		await fs.mkdir(source, { recursive: true });
		await writeManifest(source, {
			id: "com.example.cool",
			name: "Cool Extension",
			version: "1.2.0",
			main: "index.js",
			permissions: [],
			description: "Does cool things",
		});
		await fs.writeFile(path.join(source, "index.js"), "// entry", "utf-8");

		const { installExtensionFromPath, getExtension } = await import(
			"../extensions/extensionLoader"
		);
		const info = await installExtensionFromPath(source);

		expect(info).not.toBeNull();
		expect(info!.manifest.id).toBe("com.example.cool");
		expect(info!.status).toBe("installed");
		expect(getExtension("com.example.cool")?.manifest.name).toBe("Cool Extension");

		// Files were copied into the extensions directory.
		const installedMain = await fs.readFile(
			path.join(info!.path, "index.js"),
			"utf-8",
		);
		expect(installedMain).toBe("// entry");
	});

	it("rejects installs with a missing or invalid manifest", async () => {
		const { installExtensionFromPath } = await import("../extensions/extensionLoader");

		const missing = path.join(userDataDir, "source", "missing-manifest");
		await fs.mkdir(missing, { recursive: true });
		expect(await installExtensionFromPath(missing)).toBeNull();

		const broken = path.join(userDataDir, "source", "broken-manifest");
		await fs.mkdir(broken, { recursive: true });
		await fs.writeFile(path.join(broken, "morec-extension.json"), "{not json", "utf-8");
		expect(await installExtensionFromPath(broken)).toBeNull();
	});

	it("rejects manifests whose main entry escapes the extension directory", async () => {
		const { installExtensionFromPath } = await import("../extensions/extensionLoader");
		const source = path.join(userDataDir, "source", "escape-main");
		await fs.mkdir(source, { recursive: true });
		await writeManifest(source, {
			id: "com.example.escape",
			name: "Escape",
			version: "1.0.0",
			main: "../../outside.js",
		});

		expect(await installExtensionFromPath(source)).toBeNull();
	});

	it("rejects manifests with unsafe extension ids", async () => {
		const { installExtensionFromPath } = await import("../extensions/extensionLoader");
		const source = path.join(userDataDir, "source", "bad-id");
		await fs.mkdir(source, { recursive: true });
		await writeManifest(source, {
			id: "../evil-id",
			name: "Evil",
			version: "1.0.0",
			main: "index.js",
		});

		expect(await installExtensionFromPath(source)).toBeNull();
	});

	it("discovers installed extensions and reports invalid ones as errors", async () => {
		const validSource = path.join(userDataDir, "source", "valid");
		await fs.mkdir(validSource, { recursive: true });
		await writeManifest(validSource, {
			id: "com.example.valid",
			name: "Valid",
			version: "2.0.0",
			main: "index.js",
		});
		await fs.writeFile(path.join(validSource, "index.js"), "// entry", "utf-8");
		const { installExtensionFromPath, discoverExtensions } = await import(
			"../extensions/extensionLoader"
		);
		await installExtensionFromPath(validSource);

		// A stray directory with an invalid manifest.
		const invalidDir = path.join(userDataDir, "extensions", "broken-ext");
		await fs.mkdir(invalidDir, { recursive: true });
		await writeManifest(invalidDir, { name: "no id here" });

		const discovered = await discoverExtensions();
		const valid = discovered.find((entry) => entry.manifest.id === "com.example.valid");
		expect(valid?.status).toBe("installed");
		const broken = discovered.find((entry) => entry.manifest.id === "broken-ext");
		expect(broken?.status).toBe("error");
	});

	it("persists status changes and refuses unknown ids", async () => {
		const source = path.join(userDataDir, "source", "status-ext");
		await fs.mkdir(source, { recursive: true });
		await writeManifest(source, {
			id: "com.example.status",
			name: "Status",
			version: "1.0.0",
			main: "index.js",
		});
		const { installExtensionFromPath, setExtensionStatus, getExtension } = await import(
			"../extensions/extensionLoader"
		);
		await installExtensionFromPath(source);

		expect(await setExtensionStatus("com.example.status", "disabled")).toBe(true);
		expect(getExtension("com.example.status")?.status).toBe("disabled");
		expect(await setExtensionStatus("does.not.exist", "active")).toBe(false);

		const persisted = JSON.parse(
			await fs.readFile(path.join(userDataDir, "extension-state.json"), "utf-8"),
		);
		expect(persisted["com.example.status"]).toBe("disabled");
	});

	it("uninstalls user extensions and refuses unknown ids", async () => {
		const source = path.join(userDataDir, "source", "uninstall-me");
		await fs.mkdir(source, { recursive: true });
		await writeManifest(source, {
			id: "com.example.toremove",
			name: "To Remove",
			version: "1.0.0",
			main: "index.js",
		});
		const { installExtensionFromPath, uninstallExtension, getExtension } = await import(
			"../extensions/extensionLoader"
		);
		const info = await installExtensionFromPath(source);
		expect(await uninstallExtension("com.example.toremove")).toBe(true);
		expect(getExtension("com.example.toremove")).toBeUndefined();
		await expect(fs.access(info!.path)).rejects.toMatchObject({ code: "ENOENT" });

		expect(await uninstallExtension("does.not.exist")).toBe(false);
	});

	it("marketplace download rejects untrusted origins and unsafe ids before any I/O", async () => {
		await import("../extensions/extensionLoader");
		const { downloadAndInstallExtension } = await import("../extensions/extensionMarketplace");

		const badOrigin = await downloadAndInstallExtension(
			"com.example.cool",
			"https://evil.example/extension.zip",
		);
		expect(badOrigin.success).toBe(false);
		expect(badOrigin.error).toContain("Untrusted download origin");

		const badId = await downloadAndInstallExtension(
			"../evil-id",
			"https://marketplace.morec.app/extension.zip",
		);
		expect(badId.success).toBe(false);
		expect(badId.error).toBe("Invalid extension id");

		const malformedUrl = await downloadAndInstallExtension(
			"com.example.cool",
			"not a url",
		);
		expect(malformedUrl.success).toBe(false);
		expect(malformedUrl.error).toBe("Invalid download URL");
	});
});
