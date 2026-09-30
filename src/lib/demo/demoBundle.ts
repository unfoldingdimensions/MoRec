/**
 * Self-contained interactive click-through demo bundle (pure): renders the
 * step graph into a single HTML document — screenshots embedded as `data:`
 * URIs, inline CSS and JS, no network requests, no external assets, no
 * server. Hotspot clicks advance the step; a Back control and an "N / M"
 * counter are always visible; the last step offers Restart.
 *
 * Escaping is a security requirement, not polish: every user-derived string
 * (demo title, anything derived from filenames) is HTML-escaped, and the
 * embedded step payload is serialized so `</script>` inside user data can
 * never terminate the script tag.
 */

export interface DemoBundleStep {
	/** Source time of the step screenshot; kept for aria labels and debugging. */
	timeMs: number;
	/** The step screenshot as a `data:` URI (caller-provided). */
	screenshotDataUrl: string;
	/**
	 * Canvas-normalized hotspot advancing to the next step; null on the final
	 * step, which offers Restart instead.
	 */
	advance: { cx: number; cy: number } | null;
}

export interface DemoBundleInput {
	/** Demo title; escaped before embedding. */
	title: string;
	steps: DemoBundleStep[];
}

/** Escapes a value for safe interpolation into HTML text/attribute context. */
export function escapeHtml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

/**
 * Serializes a value as JSON that is safe to embed inside a `<script>` tag:
 * `<`, `>`, `&`, and the line separators U+2028/U+2029 are escaped to their
 * `\uXXXX` forms, so `</script>` in user data cannot terminate the element
 * and the output stays valid in any script context.
 */
export function serializeDemoPayload(data: unknown): string {
	return JSON.stringify(data, null, 2)
		.replace(/</g, "\\u003c")
		.replace(/>/g, "\\u003e")
		.replace(/&/g, "\\u0026")
		.replace(/\u2028/g, "\\u2028")
		.replace(/\u2029/g, "\\u2029");
}

const BUNDLE_STYLES = `
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body { height: 100%; }
body {
	background: #101014;
	color: #f4f4f6;
	font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	gap: 12px;
	padding: 16px;
	user-select: none;
}
#demo-stage {
	position: relative;
	max-width: min(100%, 1280px);
	max-height: calc(100vh - 96px);
	box-shadow: 0 18px 48px rgba(0, 0, 0, 0.55);
	border-radius: 10px;
	overflow: hidden;
	background: #000;
}
#demo-stage img {
	display: block;
	max-width: 100%;
	max-height: calc(100vh - 96px);
}
#demo-hud {
	display: flex;
	align-items: center;
	gap: 12px;
}
#demo-counter { font-size: 13px; font-variant-numeric: tabular-nums; opacity: 0.85; }
#demo-title { font-size: 14px; font-weight: 600; opacity: 0.95; }
button.demo-control {
	border: 1px solid rgba(255, 255, 255, 0.25);
	background: rgba(255, 255, 255, 0.08);
	color: inherit;
	font: inherit;
	font-size: 13px;
	padding: 6px 14px;
	border-radius: 8px;
	cursor: pointer;
}
button.demo-control:hover:enabled { background: rgba(255, 255, 255, 0.16); }
button.demo-control:disabled { opacity: 0.4; cursor: default; }
#demo-hotspot {
	position: absolute;
	width: 44px;
	height: 44px;
	transform: translate(-50%, -50%);
	border-radius: 50%;
	border: 3px solid #ffffff;
	box-shadow: 0 0 0 6px rgba(37, 99, 235, 0.45), 0 6px 18px rgba(0, 0, 0, 0.4);
	background: rgba(37, 99, 235, 0.35);
	cursor: pointer;
	padding: 0;
}
#demo-hotspot::after {
	content: "";
	position: absolute;
	inset: -3px;
	border-radius: 50%;
	border: 2px solid rgba(255, 255, 255, 0.9);
	animation: demo-pulse 1.6s ease-out infinite;
}
@keyframes demo-pulse {
	0% { transform: scale(1); opacity: 0.9; }
	100% { transform: scale(1.55); opacity: 0; }
}
`;

function renderBundleScript(): string {
	return `
(function () {
	var payload = JSON.parse(document.getElementById("demo-data").textContent);
	var steps = payload.steps;
	var index = 0;
	var stage = document.getElementById("demo-stage");
	var screenshot = document.getElementById("demo-screenshot");
	var counter = document.getElementById("demo-counter");
	var back = document.getElementById("demo-back");
	var forward = document.getElementById("demo-forward");

	function hotspotTarget() {
		var existing = document.getElementById("demo-hotspot");
		if (existing) existing.remove();
		var step = steps[index];
		if (!step.advance) return;
		var button = document.createElement("button");
		button.id = "demo-hotspot";
		button.type = "button";
		button.setAttribute("aria-label", "Next step");
		button.style.left = (step.advance.cx * 100).toFixed(4) + "%";
		button.style.top = (step.advance.cy * 100).toFixed(4) + "%";
		button.addEventListener("click", function () {
			if (index < steps.length - 1) show(index + 1);
		});
		stage.appendChild(button);
	}

	function show(nextIndex) {
		index = Math.max(0, Math.min(steps.length - 1, nextIndex));
		var step = steps[index];
		screenshot.src = step.screenshotDataUrl;
		counter.textContent = (index + 1) + " / " + steps.length;
		back.disabled = index === 0;
		forward.disabled = index >= steps.length - 1;
		hotspotTarget();
	}

	back.addEventListener("click", function () { show(index - 1); });
	forward.addEventListener("click", function () { show(index + 1); });
	document.addEventListener("keydown", function (event) {
		if (event.key === "ArrowRight") show(index + 1);
		if (event.key === "ArrowLeft") show(index - 1);
	});

	show(0);
})();
`;
}

/**
 * Renders the complete self-contained demo document. The caller supplies the
 * screenshots as `data:` URIs — the generator never touches the filesystem,
 * so the output cannot leak local paths.
 */
export function renderDemoBundleHtml(input: DemoBundleInput): string {
	const title = escapeHtml(input.title);
	const payload = serializeDemoPayload({
		steps: input.steps.map((step) => ({
			timeMs: step.timeMs,
			screenshotDataUrl: step.screenshotDataUrl,
			advance: step.advance,
		})),
	});

	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>${BUNDLE_STYLES}</style>
</head>
<body>
<div id="demo-title">${title}</div>
<div id="demo-stage">
<img id="demo-screenshot" alt="">
</div>
<div id="demo-hud">
<button id="demo-back" type="button" class="demo-control">Back</button>
<span id="demo-counter" aria-live="polite"></span>
<button id="demo-forward" type="button" class="demo-control">Next</button>
</div>
<script type="application/json" id="demo-data">${payload}</script>
<script>${renderBundleScript()}</script>
</body>
</html>
`;
}

/** Default demo file name derived from the recording's file name. */
export function buildDemoFileName(videoFileName: string): string {
	const baseName = videoFileName.replace(/\.[^.]+$/, "").trim() || "recording";
	return `${baseName}-demo.html`;
}

/**
 * Demo title derived from the recording's URL: the base name of the local
 * file or media-server `?path=` target, extension stripped. Never a
 * filesystem path — the bundle must not carry one.
 */
export function buildDemoTitleFromVideoUrl(videoUrl: string): string {
	let candidate: string | null = null;
	try {
		const parsed = new URL(videoUrl, "file:///session/index.html");
		const pathParam = parsed.searchParams.get("path");
		if (pathParam) {
			candidate = pathParam;
		} else {
			candidate = decodeURIComponent(parsed.pathname);
		}
	} catch {
		candidate = videoUrl;
	}

	const baseName = candidate.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? "";
	return buildDemoFileName(baseName).replace(/-demo\.html$/i, "") || "recording";
}
