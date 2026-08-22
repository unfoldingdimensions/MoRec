import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const localesDir = path.join(root, "src", "i18n", "locales");

const locales = fs
	.readdirSync(localesDir)
	.filter((entry) => {
		const fullPath = path.join(localesDir, entry);
		return fs.statSync(fullPath).isDirectory();
	})
	.sort((left, right) => left.localeCompare(right));

if (!locales.includes("en")) {
	console.error('i18n-check: expected base locale directory "en"');
	process.exit(1);
}

function loadJson(filePath) {
	try {
		return JSON.parse(fs.readFileSync(filePath, "utf8"));
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(`i18n-check: failed to load ${path.relative(root, filePath)}: ${message}`);
	}
}

function collectKeyPaths(obj, prefix = "") {
	if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
		return prefix ? [prefix] : [];
	}

	const keys = Object.keys(obj);
	if (keys.length === 0) {
		return prefix ? [prefix] : [];
	}

	const paths = [];
	for (const key of keys) {
		const nextPrefix = prefix ? `${prefix}.${key}` : key;
		const value = obj[key];
		if (value && typeof value === "object" && !Array.isArray(value)) {
			paths.push(...collectKeyPaths(value, nextPrefix));
		} else {
			paths.push(nextPrefix);
		}
	}
	return paths;
}

const baseLocaleDir = path.join(localesDir, "en");
const namespaceFiles = fs
	.readdirSync(baseLocaleDir)
	.filter((file) => file.endsWith(".json"))
	.sort((left, right) => left.localeCompare(right));

let hasErrors = false;

for (const namespaceFile of namespaceFiles) {
	const baseData = loadJson(path.join(baseLocaleDir, namespaceFile));
	const baseKeys = new Set(collectKeyPaths(baseData));

	for (const locale of locales) {
		if (locale === "en") continue;

		const localeFile = path.join(localesDir, locale, namespaceFile);
		if (!fs.existsSync(localeFile)) {
			console.error(`i18n-check: missing namespace file ${locale}/${namespaceFile}`);
			hasErrors = true;
			continue;
		}

		const localeData = loadJson(localeFile);
		const localeKeys = new Set(collectKeyPaths(localeData));

		for (const key of baseKeys) {
			if (!localeKeys.has(key)) {
				console.error(`i18n-check: missing key ${locale}/${namespaceFile}:${key}`);
				hasErrors = true;
			}
		}

		for (const key of localeKeys) {
			if (!baseKeys.has(key)) {
				console.error(`i18n-check: extra key ${locale}/${namespaceFile}:${key}`);
				hasErrors = true;
			}
		}
	}
}

if (hasErrors) {
	process.exit(1);
}

console.log("i18n-check: locale files are structurally consistent");

// ── Usage validation ─────────────────────────────────────────────────────────
// Extracts t("...") string literals from src and verifies every key exists in
// the en locale under the namespace it actually resolves to. Scoped bindings
// (`const t = useScopedT("editor")`) are tracked per file so a key that exists
// in a different namespace is still reported as missing.
const srcDir = path.join(root, "src");

function walkSourceFiles(dir, accumulator) {
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const fullPath = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			walkSourceFiles(fullPath, accumulator);
		} else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.(ts|tsx)$/.test(entry.name)) {
			accumulator.push(fullPath);
		}
	}
	return accumulator;
}

function keyExists(namespaceData, dottedKey) {
	const segments = dottedKey.split(".");
	let node = namespaceData;
	for (const segment of segments) {
		if (!node || typeof node !== "object" || !(segment in node)) {
			return false;
		}
		node = node[segment];
	}
	return node !== undefined;
}

const namespaceDataByName = new Map(
	namespaceFiles.map((file) => [file.replace(/\.json$/, ""), loadJson(path.join(baseLocaleDir, file))]),
);

const sourceFiles = walkSourceFiles(srcDir, []);
let usageErrors = 0;

for (const sourceFile of sourceFiles) {
	const content = fs.readFileSync(sourceFile, "utf8");

	const scopedBindings = new Map();
	for (const match of content.matchAll(
		/const\s+([A-Za-z_$][\w$]*)\s*=\s*useScopedT\(\s*(["'])((?:\\.|(?!\2).)*)\2\s*\)/g,
	)) {
		scopedBindings.set(match[1], match[3]);
	}
	const hasFlatT = /const\s*\{\s*t\s*\}\s*=\s*useI18n\s*\(/.test(content);
	if (scopedBindings.size === 0 && !hasFlatT) {
		continue;
	}

	const fileScopes = [...scopedBindings.values()];

	for (const match of content.matchAll(
		/\bt(\w*)\(\s*(["'])((?:\\.|(?!\2).)*)\2/g,
	)) {
		const callee = `t${match[1]}`;
		const key = match[3];
		// Skip path/MIME-like literals (shadowed variables, not i18n keys).
		if (!key || key.includes("${") || key.includes("/")) {
			continue;
		}

		const scope = scopedBindings.get(callee);
		let resolved = false;
		if (scope) {
			resolved = keyExists(namespaceDataByName.get(scope) ?? {}, key);
		} else if (callee === "t" && hasFlatT) {
			const namespace = key.split(".")[0];
			const rest = key.slice(namespace.length + 1);
			resolved =
				rest.length > 0 &&
				namespaceDataByName.has(namespace) &&
				keyExists(namespaceDataByName.get(namespace), rest);
			// Files can mix flat and scoped usage: also accept scoped resolution.
			if (!resolved) {
				resolved = fileScopes.some((fileScope) =>
					keyExists(namespaceDataByName.get(fileScope) ?? {}, key),
				);
			}
		} else {
			// Unknown alias (imported helper): accept flat or any file scope.
			const namespace = key.split(".")[0];
			const rest = key.slice(namespace.length + 1);
			resolved =
				(rest.length > 0 &&
					namespaceDataByName.has(namespace) &&
					keyExists(namespaceDataByName.get(namespace), rest)) ||
				fileScopes.some((fileScope) =>
					keyExists(namespaceDataByName.get(fileScope) ?? {}, key),
				);
		}

		if (!resolved) {
			const scopeHint = scope ? ` (scoped: ${scope})` : "";
			console.error(
				`i18n-check: missing usage key ${path.relative(root, sourceFile)}: t("${key}")${scopeHint}`,
			);
			usageErrors += 1;
		}
	}
}

if (usageErrors > 0) {
	console.error(`i18n-check: ${usageErrors} keys used in code are missing from the en locale`);
	process.exit(1);
}

console.log("i18n-check: all t() usage resolves against the en locale");
