import { readAppSettingValue } from "../register/settings";
import type { CaptionCuePayload } from "../types";
import {
	AI_CREDENTIALS_STORE_KEY,
	loadSecret,
	redactCredentials,
} from "./credentials";
import {
	deriveHeuristicSummary,
	type HeuristicChapter,
	type HeuristicSilenceInterval,
	type HeuristicZoomRegion,
} from "./heuristics";

/**
 * AI titles/summaries/chapters: one IPC, two engines.
 *
 * - BYO engine: any OpenAI-compatible chat-completions endpoint configured in
 *   Settings. Strict JSON response contract; malformed output falls back to
 *   the heuristic engine rather than failing the request.
 * - Heuristic engine: always available (see ./heuristics).
 *
 * The API key is decrypted here in the main process, used only for the
 * Authorization header, and never logged or returned to the renderer.
 */

export const DEFAULT_AI_ENDPOINT = "https://api.openai.com/v1/chat/completions";
const AI_REQUEST_TIMEOUT_MS = 30_000;
const MAX_CHAPTERS = 12;

export interface TranscriptSummaryResult {
	engine: "ai" | "heuristic";
	title: string;
	summary: string;
	chapters: HeuristicChapter[];
}

export interface SummarizeTranscriptInput {
	videoPath?: string | null;
	cues: CaptionCuePayload[];
	zoomRegions: HeuristicZoomRegion[];
	durationMs: number;
	silenceIntervals?: HeuristicSilenceInterval[];
}

type FetchLike = typeof fetch;

function formatTimestamp(ms: number): string {
	const totalSeconds = Math.max(0, Math.round(ms / 1000));
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/** Strict contract: { title, summary, chapters: [{ startMs, title }] }. */
export function parseAiSummaryPayload(
	raw: string,
	durationMs: number,
): Omit<TranscriptSummaryResult, "engine"> | null {
	let text = raw.trim();
	// Some models wrap JSON in code fences despite instructions.
	const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
	if (fenceMatch) {
		text = fenceMatch[1].trim();
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		return null;
	}
	if (typeof parsed !== "object" || parsed === null) {
		return null;
	}
	const record = parsed as Record<string, unknown>;

	const title = typeof record.title === "string" ? record.title.trim() : "";
	const summary = typeof record.summary === "string" ? record.summary.trim() : "";
	if (!title || !summary) {
		return null;
	}
	if (!Array.isArray(record.chapters)) {
		return null;
	}

	const chapters: HeuristicChapter[] = [];
	for (const entry of record.chapters) {
		if (typeof entry !== "object" || entry === null) {
			return null;
		}
		const chapter = entry as Record<string, unknown>;
		const startMs =
			typeof chapter.startMs === "number" && Number.isFinite(chapter.startMs)
				? Math.round(chapter.startMs)
				: Number.NaN;
		const chapterTitle =
			typeof chapter.title === "string" ? chapter.title.trim() : "";
		if (!Number.isFinite(startMs) || !chapterTitle) {
			return null;
		}
		chapters.push({ startMs: Math.max(0, startMs), title: chapterTitle });
	}

	chapters.sort((left, right) => left.startMs - right.startMs);
	const deduped: HeuristicChapter[] = [];
	for (const chapter of chapters) {
		if (deduped.length > 0 && chapter.startMs === deduped[deduped.length - 1].startMs) {
			continue;
		}
		deduped.push(chapter);
	}
	const bounded = deduped
		.filter((chapter) => durationMs <= 0 || chapter.startMs < durationMs)
		.slice(0, MAX_CHAPTERS);

	return { title, summary, chapters: bounded };
}

export function buildSummarizePrompt(input: SummarizeTranscriptInput): string {
	const transcript = input.cues
		.map((cue) => `${formatTimestamp(cue.startMs)} ${cue.text.trim()}`)
		.filter((line) => line.length > 10)
		.join("\n");
	const zoomLines = input.zoomRegions
		.map(
			(region) =>
				`- ${formatTimestamp(region.startMs)} (depth ${region.depth ?? 1})`,
		)
		.join("\n");

	return [
		"You label screen-recording videos. Respond with ONLY a JSON object, no prose, no code fences, matching exactly:",
		'{"title": string, "summary": string, "chapters": [{"startMs": number, "title": string}]}',
		"Rules:",
		"- title: a concise video title (max 80 characters).",
		"- summary: a 1-3 sentence summary of the recording.",
		"- chapters: 0 to 12 chapter markers. startMs is a millisecond offset into the video. Every chapter needs a short descriptive title.",
		"- Use the transcript and the zoom timeline to choose meaningful chapter boundaries.",
		"",
		`Video duration: ${formatTimestamp(input.durationMs)}.`,
		zoomLines ? `Zoom timeline:\n${zoomLines}` : "No zoom regions.",
		"",
		"Transcript:",
		transcript || "(no speech detected)",
	].join("\n");
}

export async function runAiEngine(options: {
	endpoint: string;
	model: string;
	apiKey: string;
	prompt: string;
	durationMs: number;
	fetchImpl?: FetchLike;
}): Promise<Omit<TranscriptSummaryResult, "engine"> | null> {
	const { endpoint, model, apiKey, prompt } = options;
	const doFetch = options.fetchImpl ?? fetch;

	const attempt = async (): Promise<Response> => {
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), AI_REQUEST_TIMEOUT_MS);
		try {
			return await doFetch(endpoint, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${apiKey}`,
				},
				body: JSON.stringify({
					model,
					messages: [
						{
							role: "system",
							content:
								"You are a helpful assistant that outputs only valid JSON.",
						},
						{ role: "user", content: prompt },
					],
					temperature: 0.2,
				}),
				signal: controller.signal,
			});
		} finally {
			clearTimeout(timeout);
		}
	};

	let response: Response;
	try {
		response = await attempt();
		if (response.status === 429) {
			// Single rate-limit retry before giving up and falling back.
			response = await attempt();
		}
	} catch {
		return null;
	}

	if (!response.ok) {
		return null;
	}

	let payload: unknown;
	try {
		payload = await response.json();
	} catch {
		return null;
	}
	if (typeof payload !== "object" || payload === null) {
		return null;
	}
	const choices = (payload as Record<string, unknown>).choices;
	if (!Array.isArray(choices) || choices.length === 0) {
		return null;
	}
	const message = (choices[0] as Record<string, unknown>).message;
	if (typeof message !== "object" || message === null) {
		return null;
	}
	const content = (message as Record<string, unknown>).content;
	if (typeof content !== "string") {
		return null;
	}

	return parseAiSummaryPayload(content, options.durationMs);
}

function readAiEndpoint(): string {
	const stored = readAppSettingValue("aiEndpoint");
	return typeof stored === "string" && stored.trim() ? stored.trim() : DEFAULT_AI_ENDPOINT;
}

function readAiModel(): string | null {
	const stored = readAppSettingValue("aiModel");
	return typeof stored === "string" && stored.trim() ? stored.trim() : null;
}

/**
 * Full summarize pipeline: AI engine when configured, heuristic fallback
 * otherwise or on any AI failure. Never throws credential material into
 * errors — failures are reported as plain strings.
 */
export async function summarizeTranscript(
	input: SummarizeTranscriptInput,
	fetchImpl?: FetchLike,
): Promise<TranscriptSummaryResult> {
	const cues = Array.isArray(input.cues) ? input.cues : [];
	const zoomRegions = Array.isArray(input.zoomRegions) ? input.zoomRegions : [];
	const durationMs = Number.isFinite(input.durationMs) ? Math.max(0, input.durationMs) : 0;

	const model = readAiModel();
	const endpoint = readAiEndpoint();
	let keyMaterial: string | undefined;
	if (model) {
		try {
			keyMaterial = loadSecret(AI_CREDENTIALS_STORE_KEY);
		} catch {
			keyMaterial = undefined;
		}
	}

	if (model && endpoint && keyMaterial) {
		try {
			const aiResult = await runAiEngine({
				endpoint,
				model,
				apiKey: keyMaterial,
				prompt: buildSummarizePrompt({ ...input, cues, zoomRegions, durationMs }),
				durationMs,
				fetchImpl,
			});
			if (aiResult) {
				return { engine: "ai", ...aiResult };
			}
		} catch (error) {
			// Defense in depth: nothing below may embed the key in a message.
			console.error(
				"[ai-summary] AI engine failed, falling back to heuristics:",
				redactCredentials(error instanceof Error ? error.message : String(error), [
					keyMaterial,
				]),
			);
		}
	}

	const heuristic = deriveHeuristicSummary({
		cues,
		zoomRegions,
		durationMs,
		silenceIntervals: input.silenceIntervals,
		fallbackTitle: input.videoPath
			? (input.videoPath.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, "") ?? undefined)
			: undefined,
	});
	return { engine: "heuristic", ...heuristic };
}
