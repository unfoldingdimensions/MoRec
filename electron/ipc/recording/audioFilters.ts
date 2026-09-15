// Keep native mic capture dry by default. Automatic loudness normalization
// amplified wireless-headset noise and WASAPI discontinuities during beta tests.
export const WINDOWS_NATIVE_MIC_PRE_FILTERS = ["adeclip=threshold=1"];

// Browser mic fallback uses Chromium/WebRTC voice processing, but beta tests
// showed its realtime AGC can introduce short crackle bursts on some Realtek
// and headset paths. Default to no AGC, then restore usable level offline with
// bounded speech expansion and a limiter.
export const BROWSER_MIC_SIDECAR_BASE_FILTERS = [
	"adeclip=threshold=1",
	"adeclick=w=40:o=75:t=3:b=2",
	"highpass=f=85",
	"lowpass=f=9500",
	"afftdn=nr=10:nf=-45:tn=1",
];

export const BROWSER_MIC_SIDECAR_NO_AGC_GAIN_FILTERS = [
	"speechnorm=p=0.92:e=12:c=2:r=0.0005:f=0.001",
	"alimiter=limit=0.92:level=0",
];

export const BROWSER_MIC_SIDECAR_FILTERS = [
	...BROWSER_MIC_SIDECAR_BASE_FILTERS,
	"alimiter=limit=0.92:level=0",
];

export function getBrowserMicSidecarFilters(profile?: string | null) {
	if (profile === "no-agc") {
		return [...BROWSER_MIC_SIDECAR_BASE_FILTERS, ...BROWSER_MIC_SIDECAR_NO_AGC_GAIN_FILTERS];
	}

	return BROWSER_MIC_SIDECAR_FILTERS;
}

export const BROWSER_MIC_SIDECAR_MIN_TIMEOUT_MS = 120_000;
export const BROWSER_MIC_SIDECAR_MAX_TIMEOUT_MS = 30 * 60_000;
/** Extra transcode budget added per 4 MB of opus/webm source (~2 min of audio). */
const BROWSER_MIC_SIDECAR_TIMEOUT_MS_PER_4MB = 120_000;

/**
 * Transcode budget for the browser-mic sidecar conversion. The filter chain
 * (afftdn + speechnorm) is far from free, so a fixed 2-minute timeout killed
 * long recordings' sidecars on slow CPUs; scale with the source size instead.
 */
export function getBrowserMicSidecarTimeoutMs(sourceBytes: number) {
	const megabytes = Math.max(0, sourceBytes) / (1024 * 1024);
	const scaled =
		BROWSER_MIC_SIDECAR_MIN_TIMEOUT_MS +
		Math.floor(megabytes / 4) * BROWSER_MIC_SIDECAR_TIMEOUT_MS_PER_4MB;
	return Math.min(BROWSER_MIC_SIDECAR_MAX_TIMEOUT_MS, scaled);
}

// Set MOREC_KEEP_RECORDING_AUDIO_SIDECARS=1 to keep the browser mic sidecar's
// unfiltered source webm (and orphaned native mic sidecars) next to the
// recording for diagnostics instead of deleting them after conversion.
export const RECORDING_AUDIO_SIDECAR_DEBUG_ENV = "MOREC_KEEP_RECORDING_AUDIO_SIDECARS";

export function shouldKeepRecordingAudioSidecars(env: NodeJS.ProcessEnv = process.env) {
	const value = env[RECORDING_AUDIO_SIDECAR_DEBUG_ENV]?.trim().toLowerCase();
	return value === "1" || value === "true" || value === "yes" || value === "on";
}
