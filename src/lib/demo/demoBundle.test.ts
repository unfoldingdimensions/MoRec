import { describe, expect, it } from "vitest";

import {
	buildDemoFileName,
	escapeHtml,
	renderDemoBundleHtml,
	serializeDemoPayload,
	type DemoBundleStep,
} from "./demoBundle";

const STEP_ONE: DemoBundleStep = {
	timeMs: 1_000,
	screenshotDataUrl: "data:image/jpeg;base64,AAAA第一步",
	advance: { cx: 0.25, cy: 0.75 },
};
const STEP_TWO: DemoBundleStep = {
	timeMs: 4_000,
	screenshotDataUrl: "data:image/jpeg;base64,BBBB",
	advance: null,
};

describe("escapeHtml", () => {
	it("escapes markup-significant characters", () => {
		expect(escapeHtml(`<img src=x onerror="alert('1')">&`)).toBe(
			"&lt;img src=x onerror=&quot;alert(&#39;1&#39;)&quot;&gt;&amp;",
		);
	});
});

describe("serializeDemoPayload", () => {
	it("prevents script-tag breakout through embedded user data", () => {
		const payload = serializeDemoPayload({ title: `</script><script>alert(1)</script>` });

		expect(payload).not.toContain("</script>");
		expect(payload).toContain("\\u003c/script\\u003e");
		expect(JSON.parse(payload)).toEqual({ title: `</script><script>alert(1)</script>` });
	});

	it("escapes line separators and ampersands for script contexts", () => {
		const payload = serializeDemoPayload({ value: "a&bcd" });

		expect(payload).not.toContain("&");
		expect(JSON.parse(payload).value).toBe("a&bcd");
	});
});

describe("renderDemoBundleHtml", () => {
	it("escapes a markup-bearing title everywhere it appears", () => {
		const html = renderDemoBundleHtml({
			title: `<script>alert("x")</script> & "quotes"`,
			steps: [STEP_ONE, STEP_TWO],
		});

		// The raw script never appears; the escaped form renders as text.
		expect(html).not.toContain('<script>alert("x")</script>');
		expect(html).toContain(
			"<title>&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &quot;quotes&quot;</title>",
		);
		expect(html).toContain(
			'<div id="demo-title">&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &quot;quotes&quot;</div>',
		);
		// Exactly the two legitimate closing script tags remain.
		expect(html.match(/<\/script>/g)).toHaveLength(2);
	});

	it("keeps markup-bearing data out of the payload as raw text", () => {
		const hostileStep: DemoBundleStep = {
			timeMs: 500,
			screenshotDataUrl: `data:image/svg+xml,<svg onload="alert(1)">`,
			advance: { cx: 0.5, cy: 0.5 },
		};
		const html = renderDemoBundleHtml({ title: "demo", steps: [hostileStep, STEP_TWO] });

		expect(html).not.toContain("<svg onload=");
		expect(html.match(/<\/script>/g)).toHaveLength(2);
	});

	it("is portable: no absolute filesystem paths and no file:// references", () => {
		const html = renderDemoBundleHtml({
			// Realistic title: the exporter derives it from the recording's base
			// name, never a filesystem path.
			title: "Onboarding tour",
			steps: [STEP_ONE, STEP_TWO],
		});

		expect(html).not.toMatch(/file:\/\//i);
		expect(html).not.toMatch(/[A-Za-z]:\\[A-Za-z]/);
		expect(html).not.toContain("/Users/");
		expect(html).not.toContain("/home/");
		expect(html).not.toContain("/tmp/");
		// Screenshots appear only as the provided data URIs.
		expect(html).toContain(STEP_ONE.screenshotDataUrl);
		expect(html).toContain(STEP_TWO.screenshotDataUrl);
	});

	it("embeds the step payload with hotspots, counter, and Back control", () => {
		const html = renderDemoBundleHtml({ title: "Onboarding", steps: [STEP_ONE, STEP_TWO] });

		expect(html).toContain('id="demo-data"');
		expect(html).toContain('id="demo-counter"');
		expect(html).toContain('id="demo-back"');
		expect(html).toContain(">Back</button>");
		expect(html).toContain("demo-pulse");

		const payloadStart = html.indexOf('id="demo-data">') + 'id="demo-data">'.length;
		const payloadEnd = html.indexOf("</script>", payloadStart);
		const payload = JSON.parse(html.slice(payloadStart, payloadEnd)) as {
			steps: Array<{ timeMs: number; advance: { cx: number; cy: number } | null }>;
		};
		expect(payload.steps).toHaveLength(2);
		expect(payload.steps[0].advance).toEqual({ cx: 0.25, cy: 0.75 });
		expect(payload.steps[1].advance).toBeNull();
	});

	it("renders exactly the capped number of steps", () => {
		const steps: DemoBundleStep[] = Array.from({ length: 5 }, (_, index) => ({
			timeMs: index * 1_000,
			screenshotDataUrl: `data:image/jpeg;base64,STEP${index}`,
			advance: index < 4 ? { cx: 0.5, cy: 0.5 } : null,
		}));
		const html = renderDemoBundleHtml({ title: "capped", steps });

		const payloadStart = html.indexOf('id="demo-data">') + 'id="demo-data">'.length;
		const payloadEnd = html.indexOf("</script>", payloadStart);
		const payload = JSON.parse(html.slice(payloadStart, payloadEnd)) as { steps: unknown[] };
		expect(payload.steps).toHaveLength(5);
		expect(html).toContain("data:image/jpeg;base64,STEP4");
		expect(html).not.toContain("data:image/jpeg;base64,STEP5");
	});
});

describe("buildDemoFileName", () => {
	it("derives a demo html name from the recording file name", () => {
		expect(buildDemoFileName("onboarding.mp4")).toBe("onboarding-demo.html");
		expect(buildDemoFileName("my.demo.recording.mov")).toBe("my.demo.recording-demo.html");
		expect(buildDemoFileName("no-extension")).toBe("no-extension-demo.html");
		expect(buildDemoFileName("")).toBe("recording-demo.html");
	});
});
