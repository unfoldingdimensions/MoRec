import { describe, expect, it, vi } from "vitest";
import {
	buildSummarizePrompt,
	parseAiSummaryPayload,
	runAiEngine,
	summarizeTranscript,
	type SummarizeTranscriptInput,
} from "./summarize";
import type { HeuristicZoomRegion } from "./heuristics";
import type { CaptionCuePayload } from "../types";

// Fixture key for tests only — assembled so it cannot be mistaken for a real
// credential; it never leaves the test process and is never asserted verbatim.
const API_KEY = ["test", "key", "not", "a", "real", "credential"].join("-");

// Hoisted module mocks: summarize.ts imports ../register/settings (which
// drags in electron/windows — unavailable under plain Node vitest) and
// ./credentials (electron safeStorage). Both are replaced with controllable
// fakes before the static import resolves.
const settingsStore = vi.hoisted(() => new Map<string, unknown>());
vi.mock("../register/settings", () => ({
	readAppSettingValue: (key: string) => settingsStore.get(key),
}));
const secretHolder = vi.hoisted(() => ({
	value: undefined as string | undefined,
}));
vi.mock("./credentials", () => ({
	AI_CREDENTIALS_STORE_KEY: "aiCredentials",
	loadSecret: () => {
		if (secretHolder.value === undefined) {
			throw new Error("no key stored");
		}
		return secretHolder.value;
	},
	redactCredentials: (message: string) => message,
}));

function cue(startMs: number, text: string): CaptionCuePayload {
	return { id: `cue-${startMs}`, startMs, endMs: startMs + 2000, text };
}

function chatResponse(content: string, status = 200): Response {
	return new Response(
		JSON.stringify({
			choices: [{ message: { role: "assistant", content } }],
		}),
		{ status },
	);
}

const validPayload = {
	title: "Building a birdhouse",
	summary: "A quick build video.",
	chapters: [
		{ startMs: 0, title: "Intro" },
		{ startMs: 60_000, title: "Cutting boards" },
	],
};

describe("parseAiSummaryPayload", () => {
	it("accepts a contract-compliant payload", () => {
		const parsed = parseAiSummaryPayload(
			JSON.stringify(validPayload),
			300_000,
		);
		expect(parsed).toEqual(validPayload);
	});

	it("accepts JSON wrapped in code fences", () => {
		const fenced = "```json\n" + JSON.stringify(validPayload) + "\n```";
		expect(parseAiSummaryPayload(fenced, 300_000)).toEqual(validPayload);
	});

	it("rejects malformed JSON, missing fields, and wrong chapter shapes", () => {
		expect(parseAiSummaryPayload("not json", 300_000)).toBeNull();
		expect(parseAiSummaryPayload('{"title":"x"}', 300_000)).toBeNull();
		expect(
			parseAiSummaryPayload('{"title":"x","summary":"y"}', 300_000),
		).toBeNull();
		expect(
			parseAiSummaryPayload(
				JSON.stringify({ ...validPayload, chapters: "nope" }),
				300_000,
			),
		).toBeNull();
		expect(
			parseAiSummaryPayload(
				JSON.stringify({
					...validPayload,
					chapters: [{ startMs: "zero", title: "Bad" }],
				}),
				300_000,
			),
		).toBeNull();
		expect(
			parseAiSummaryPayload(
				JSON.stringify({
					title: "",
					summary: "y",
					chapters: [],
				}),
				300_000,
			),
		).toBeNull();
	});

	it("sorts chapters, drops duplicates, clamps negatives, and caps at 12", () => {
		const chapters = Array.from({ length: 15 }, (_, index) => ({
			startMs: (15 - index) * 10_000,
			title: `Chapter ${index}`,
		}));
		chapters.push({ startMs: 50_000, title: "dupe" });
		chapters.push({ startMs: -500, title: "negative" });
		const parsed = parseAiSummaryPayload(
			JSON.stringify({ title: "t", summary: "s", chapters }),
			300_000,
		);
		expect(parsed).not.toBeNull();
		expect(parsed?.chapters).toHaveLength(12);
		const starts = parsed?.chapters.map((chapter) => chapter.startMs) ?? [];
		expect(starts[0]).toBe(0);
		for (let index = 1; index < starts.length; index += 1) {
			expect(starts[index]).toBeGreaterThan(starts[index - 1]);
		}
	});
});

describe("runAiEngine", () => {
	it("sends the configured model and auth header, and parses a valid reply", async () => {
		const fetchImpl = vi.fn(async () =>
			chatResponse(JSON.stringify(validPayload)),
		);
		const result = await runAiEngine({
			endpoint: "https://api.example.test/v1/chat/completions",
			model: "test-model",
			apiKey: API_KEY,
			prompt: "prompt",
			durationMs: 300_000,
			fetchImpl,
		});
		expect(result).toEqual(validPayload);
		expect(fetchImpl).toHaveBeenCalledTimes(1);
		const [url, init] = fetchImpl.mock.calls[0] as unknown as [
			string,
			RequestInit,
		];
		expect(url).toBe("https://api.example.test/v1/chat/completions");
		expect(new Headers(init.headers).get("Authorization")).toBe(
			`Bearer ${API_KEY}`,
		);
		expect(JSON.parse(String(init.body)).model).toBe("test-model");
	});

	it("retries once on 429 before succeeding", async () => {
		const fetchImpl = vi
			.fn<(input: unknown, init?: unknown) => Promise<Response>>()
			.mockResolvedValueOnce(new Response("rate limited", { status: 429 }))
			.mockResolvedValueOnce(chatResponse(JSON.stringify(validPayload)));
		const result = await runAiEngine({
			endpoint: "https://api.example.test/v1/chat/completions",
			model: "test-model",
			apiKey: API_KEY,
			prompt: "prompt",
			durationMs: 300_000,
			fetchImpl: fetchImpl as unknown as typeof fetch,
		});
		expect(result).toEqual(validPayload);
		expect(fetchImpl).toHaveBeenCalledTimes(2);
	});

	it("returns null on network errors and HTTP failures (fallback signal)", async () => {
		const failing = async () => {
			throw new Error("boom");
		};
		await expect(
			runAiEngine({
				endpoint: "https://api.example.test",
				model: "m",
				apiKey: API_KEY,
				prompt: "p",
				durationMs: 1000,
				fetchImpl: failing as unknown as typeof fetch,
			}),
		).resolves.toBeNull();
		await expect(
			runAiEngine({
				endpoint: "https://api.example.test",
				model: "m",
				apiKey: API_KEY,
				prompt: "p",
				durationMs: 1000,
				fetchImpl: async () => new Response("denied", { status: 403 }),
			}),
		).resolves.toBeNull();
	});

	it("returns null when the model replies with prose instead of JSON", async () => {
		const result = await runAiEngine({
			endpoint: "https://api.example.test",
			model: "m",
			apiKey: API_KEY,
			prompt: "p",
			durationMs: 1000,
			fetchImpl: async () =>
				chatResponse("Here is your summary: it was a nice video!"),
		});
		expect(result).toBeNull();
	});
});

describe("summarizeTranscript", () => {
	const baseInput: SummarizeTranscriptInput = {
		videoPath: "/recordings/demo.mp4",
		cues: [cue(0, "Welcome to the demo video."), cue(3000, "We test everything.")],
		zoomRegions: [{ startMs: 30_000, endMs: 31_000, depth: 2 }] as HeuristicZoomRegion[],
		durationMs: 60_000,
	};

	it("falls back to heuristics when no model is configured", async () => {
		settingsStore.clear();
		secretHolder.value = undefined;
		const result = await summarizeTranscript(baseInput);
		expect(result.engine).toBe("heuristic");
		expect(result.title).toContain("Welcome to the demo video");
	});

	it("falls back to heuristics when the AI reply is malformed", async () => {
		settingsStore.set("aiModel", "test-model");
		settingsStore.set("aiEndpoint", "https://api.example.test");
		secretHolder.value = API_KEY;
		const result = await summarizeTranscript(baseInput, async () =>
			chatResponse("I could not produce JSON, sorry!"),
		);
		expect(result.engine).toBe("heuristic");
		expect(result.chapters[0]?.startMs).toBe(0);
	});

	it("uses the AI engine when configured and the reply is valid", async () => {
		settingsStore.set("aiModel", "test-model");
		settingsStore.set("aiEndpoint", "https://api.example.test");
		secretHolder.value = API_KEY;
		const result = await summarizeTranscript(baseInput, async () =>
			chatResponse(JSON.stringify(validPayload)),
		);
		expect(result.engine).toBe("ai");
		expect(result.title).toBe(validPayload.title);
	});

	it("never includes the API key in output or errors", async () => {
		settingsStore.set("aiModel", "test-model");
		settingsStore.set("aiEndpoint", "https://api.example.test");
		secretHolder.value = API_KEY;
		const result = await summarizeTranscript(baseInput, async () => {
			throw new Error(`HTTP 500 with leaked ${API_KEY}`);
		});
		expect(result.engine).toBe("heuristic");
		expect(JSON.stringify(result)).not.toContain(API_KEY);
	});
});
