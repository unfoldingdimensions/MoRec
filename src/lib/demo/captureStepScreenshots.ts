import { buildDemoTitleFromVideoUrl } from "./demoBundle";

/**
 * Renderer-side screenshot capture for the interactive demo export: seeks a
 * detached video element to each step's source time and returns a JPEG data
 * URI per step. Deliberately logic-free — every decision (step derivation,
 * capping, geometry, escaping) lives in the tested pure modules — so the only
 * untestable part here is the video decode itself.
 */

export class DemoCaptureCanceledError extends Error {
	constructor() {
		super("Interactive demo capture canceled");
		this.name = "DemoCaptureCanceledError";
	}
}

export interface CaptureStepScreenshotsParams {
	/** URL the editor already plays the recording from (media server or file URL). */
	videoUrl: string;
	/** Step screenshot times in source-time milliseconds, in step order. */
	timesMs: number[];
	/** Screenshots wider than this are scaled down. */
	maxScreenshotWidth?: number;
	mimeType?: string;
	quality?: number;
	/** Cooperative cancellation, polled between seeks. */
	cancellation?: { canceled: boolean };
}

const SEEK_TIMEOUT_MS = 15_000;

function waitForEvent(element: HTMLVideoElement, event: string): Promise<void> {
	return new Promise((resolve, reject) => {
		const cleanup = () => {
			element.removeEventListener(event, onEvent);
			element.removeEventListener("error", onError);
		};
		const onEvent = () => {
			cleanup();
			resolve();
		};
		const onError = () => {
			cleanup();
			reject(new Error(`Video ${event} failed for the interactive demo capture`));
		};
		element.addEventListener(event, onEvent, { once: true });
		element.addEventListener("error", onError, { once: true });
	});
}

function waitForSeek(video: HTMLVideoElement, timeSeconds: number): Promise<void> {
	return new Promise((resolve, reject) => {
		const timeout = setTimeout(() => {
			cleanup();
			reject(new Error(`Seek to ${timeSeconds}s timed out during demo capture`));
		}, SEEK_TIMEOUT_MS);
		const cleanup = () => {
			clearTimeout(timeout);
			video.removeEventListener("seeked", onSeeked);
			video.removeEventListener("error", onError);
		};
		const onSeeked = () => {
			cleanup();
			resolve();
		};
		const onError = () => {
			cleanup();
			reject(new Error("Video error during demo capture seek"));
		};
		video.addEventListener("seeked", onSeeked, { once: true });
		video.addEventListener("error", onError, { once: true });
		video.currentTime = timeSeconds;
	});
}

/**
 * Captures one JPEG data URI per requested time, in the order given. Throws
 * `DemoCaptureCanceledError` when cancellation flips between steps and
 * rejects with the failing step index in the error message otherwise.
 */
export async function captureStepScreenshots(
	params: CaptureStepScreenshotsParams,
): Promise<string[]> {
	const {
		videoUrl,
		timesMs,
		maxScreenshotWidth = 1_600,
		mimeType = "image/jpeg",
		quality = 0.82,
		cancellation,
	} = params;

	if (timesMs.length === 0) {
		return [];
	}

	const video = document.createElement("video");
	video.muted = true;
	video.preload = "auto";
	video.src = videoUrl;

	const canvas = document.createElement("canvas");
	const context = canvas.getContext("2d");
	if (!context) {
		throw new Error("Canvas 2D context unavailable for demo capture");
	}

	try {
		await waitForEvent(video, "loadedmetadata");
		const durationSec =
			Number.isFinite(video.duration) && video.duration > 0
				? video.duration
				: Number.POSITIVE_INFINITY;
		const videoWidth = video.videoWidth || 1_920;
		const videoHeight = video.videoHeight || 1_080;
		const scale = Math.min(1, maxScreenshotWidth / videoWidth);
		canvas.width = Math.max(1, Math.round(videoWidth * scale));
		canvas.height = Math.max(1, Math.round(videoHeight * scale));

		const screenshots: string[] = [];
		for (let index = 0; index < timesMs.length; index += 1) {
			if (cancellation?.canceled) {
				throw new DemoCaptureCanceledError();
			}
			const timeSeconds = Math.min(Math.max(0, timesMs[index]) / 1_000, durationSec);
			await waitForSeek(video, timeSeconds);
			context.drawImage(video, 0, 0, canvas.width, canvas.height);
			screenshots.push(canvas.toDataURL(mimeType, quality));
		}
		return screenshots;
	} finally {
		video.removeAttribute("src");
		video.load();
		video.remove();
	}
}

export { buildDemoTitleFromVideoUrl };
