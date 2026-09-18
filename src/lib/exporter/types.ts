export interface ExportConfig {
	width: number;
	height: number;
	frameRate: number;
	bitrate: number;
	codec?: string;
	encodingMode?: ExportEncodingMode;
	backendPreference?: ExportBackendPreference;
	preferredRenderBackend?: ExportRenderBackend;
	experimentalNativeExport?: boolean;
	experimentalNvidiaCudaExport?: boolean;
	/**
	 * Enables segment-resumable rendering for the native static-layout route:
	 * segments land in a per-export session dir tracked by an atomic manifest.
	 * The WebCodecs route ignores it (non-resumable by design).
	 */
	resumableSession?: ExportResumableSessionRef;
	maxEncodeQueue?: number;
	maxDecodeQueue?: number;
	maxPendingFrames?: number;
	maxInFlightNativeWrites?: number;
	sourceAudioFallbackStartDelayMsByPath?: Record<string, number>;
}

export type ExportRenderBackend = "webgpu" | "webgl";
export type ExportEncodeBackend = "ffmpeg" | "webcodecs";
export type ExportBackendPreference = "auto" | "webcodecs" | "breeze";
export type ExportPipelineModel = "modern" | "legacy";

export interface ExportProgress {
	currentFrame: number;
	totalFrames: number;
	percentage: number;
	estimatedTimeRemaining: number; // in seconds
	renderFps?: number;
	renderBackend?: ExportRenderBackend;
	encodeBackend?: ExportEncodeBackend;
	encoderName?: string;
	nativeStaticLayoutSkipReason?: string;
	nativeStaticLayoutSkipReasons?: string[];
	phase?: "preparing" | "extracting" | "finalizing" | "saving"; // Phase of export
	renderProgress?: number; // 0-100, progress of GIF rendering phase
	audioProgress?: number; // 0-1, progress of real-time audio rendering (speed/audio regions)
	/** 0-based resumable segment currently rendering (Lightning route only). */
	segmentIndex?: number;
	/** Total resumable segment count; only set alongside segmentIndex. */
	segmentCount?: number;
	/** True while the export runs with a resumable session dir on disk. */
	resumable?: boolean;
}

export interface ExportFinalizationStageMetrics {
	encoderFlushMs?: number;
	queuedMuxingMs?: number;
	audioProcessingMs?: number;
	muxerFinalizeMs?: number;
	editedAudioRenderMs?: number;
	ffmpegAudioMuxMs?: number;
	nativeExportFinalizeMs?: number;
	nativeEncoderFlushMs?: number;
	ffmpegAudioMuxBreakdown?: ExportFfmpegAudioMuxBreakdown;
}

export interface ExportFfmpegAudioMuxBreakdown {
	tempVideoWriteMs?: number;
	tempEditedAudioWriteMs?: number;
	ffmpegExecMs?: number;
	muxedVideoReadMs?: number;
	tempVideoBytes?: number;
	tempEditedAudioBytes?: number;
	muxedVideoBytes?: number;
	chunkCount?: number;
	chunkDurationSec?: number;
	chunkExecMs?: number;
	concatExecMs?: number;
	staticAssetExecMs?: number;
	fallbackChunkCount?: number;
	videoOnlyBytes?: number;
	chunks?: Array<{
		index: number;
		startSec: number;
		durationSec: number;
		backend: string;
		elapsedMs: number;
		outputBytes: number;
		fallbackReason?: string;
		windowsGpuSummary?: {
			success?: boolean;
			width?: number;
			height?: number;
			fps?: number;
			seconds?: number;
			mediaMs?: number;
			frames?: number;
			gpuDecodeSurface?: boolean;
			webcamOverlay?: boolean;
			cursorOverlay?: boolean;
			zoomOverlay?: boolean;
			surfacePoolSize?: number;
			adapterIndex?: number;
			adapterVendorId?: number;
			adapterDeviceId?: number;
			adapterDedicatedVideoMemoryMB?: number;
			encoderBackend?: string;
			encoderTuningApplied?: boolean;
			nvencOutputBytes?: number;
			initializeMs?: number;
			initCoInitializeMs?: number;
			initMfStartupMs?: number;
			initD3DDeviceMs?: number;
			initSourceReaderMs?: number;
			initWebcamReaderMs?: number;
			initVideoProcessorMs?: number;
			initTexturesMs?: number;
			initShaderPipelineMs?: number;
			initSinkWriterMs?: number;
			totalMs?: number;
			readMs?: number;
			clearMs?: number;
			videoProcessMs?: number;
			writeSampleMs?: number;
			finalizeMs?: number;
			realtimeMultiplier?: number;
		};
	}>;
}

export interface ExportMetrics {
	totalElapsedMs: number;
	metadataLoadMs?: number;
	rendererInitMs?: number;
	nativeSessionStartMs?: number;
	decodeLoopMs?: number;
	frameCallbackMs?: number;
	renderFrameMs?: number;
	encodeWaitMs?: number;
	encodeWaitEvents?: number;
	peakEncodeQueueSize?: number;
	peakNativeWriteInFlight?: number;
	nativeCaptureMs?: number;
	nativeWriteMs?: number;
	finalizationMs?: number;
	frameCount?: number;
	renderBackend?: ExportRenderBackend;
	encodeBackend?: ExportEncodeBackend;
	encoderName?: string;
	backpressureProfile?: string;
	nativeStaticLayoutSkipReason?: string;
	nativeStaticLayoutSkipReasons?: string[];
	averageFrameCallbackMs?: number;
	averageRenderFrameMs?: number;
	averageEncodeWaitMs?: number;
	averageNativeCaptureMs?: number;
	averageNativeWriteMs?: number;
	effectiveDurationSec?: number;
	finalizationStageMs?: ExportFinalizationStageMetrics;
}

export interface ExportResult {
	success: boolean;
	/**
	 * Absolute path to a main-process temp file containing the finished export.
	 * Preferred for MP4 output because it avoids loading multi-gigabyte files
	 * into the renderer's ArrayBuffer heap. The renderer should move the temp
	 * file to its final destination via `finalize-exported-video`.
	 */
	tempFilePath?: string;
	/**
	 * In-renderer Blob for exports that fit in memory (GIF, smoke tests, legacy
	 * fallback). Mutually exclusive with `tempFilePath` — consumers should
	 * prefer the temp path when both are set.
	 */
	blob?: Blob;
	filePath?: string;
	error?: string;
	/** True when the export ended because the user cancelled it — not an error. */
	cancelled?: boolean;
	/**
	 * Present when the export failed but a resumable native session dir was
	 * kept on disk; the renderer can offer to resume via this token.
	 */
	resumeToken?: string;
	metrics?: ExportMetrics;
}

export interface VideoFrameData {
	frame: VideoFrame;
	timestamp: number; // in microseconds
	duration: number; // in microseconds
}

export type ExportEncodingMode = "fast" | "balanced" | "quality";

/** Identifies a resumable export session; the hash gates settings-match. */
export interface ExportResumableSessionRef {
	exportId: string;
	settingsHash: string;
}

export type ExportQuality = "medium" | "good" | "high" | "source" | "target-size";

export type ExportMp4FrameRate = 24 | 30 | 60;

// GIF Export Types
export type ExportFormat = "mp4" | "gif";

export type GifFrameRate = 15 | 20 | 25 | 30;

export type GifSizePreset = "medium" | "large" | "original";

export interface GifExportConfig {
	frameRate: GifFrameRate;
	loop: boolean;
	sizePreset: GifSizePreset;
	width: number;
	height: number;
}

export interface ExportSettings {
	format: ExportFormat;
	includeCaptionSidecar?: boolean;
	// MP4 settings
	quality?: ExportQuality;
	/** Only meaningful when `quality` is "target-size" — the desired output size in MB. */
	targetSizeMb?: number;
	encodingMode?: ExportEncodingMode;
	mp4FrameRate?: ExportMp4FrameRate;
	backendPreference?: ExportBackendPreference;
	pipelineModel?: ExportPipelineModel;
	/** Resume an interrupted native export session (Lightning route only). */
	resume?: ExportResumableSessionRef;
	// GIF settings
	gifConfig?: GifExportConfig;
}

export const MP4_FRAME_RATES: readonly ExportMp4FrameRate[] = [24, 30, 60] as const;

export function isValidMp4FrameRate(rate: number): rate is ExportMp4FrameRate {
	return MP4_FRAME_RATES.includes(rate as ExportMp4FrameRate);
}

export const GIF_SIZE_PRESETS: Record<GifSizePreset, { maxHeight: number; label: string }> = {
	medium: { maxHeight: 720, label: "Medium (720p)" },
	large: { maxHeight: 1080, label: "Large (1080p)" },
	original: { maxHeight: Infinity, label: "Original" },
};

export const GIF_FRAME_RATES: { value: GifFrameRate; label: string }[] = [
	{ value: 15, label: "15 FPS - Balanced" },
	{ value: 20, label: "20 FPS - Smooth" },
	{ value: 25, label: "25 FPS - Very smooth" },
	{ value: 30, label: "30 FPS - Maximum" },
];

// Valid frame rates for validation
export const VALID_GIF_FRAME_RATES: readonly GifFrameRate[] = [15, 20, 25, 30] as const;

export function isValidGifFrameRate(rate: number): rate is GifFrameRate {
	return VALID_GIF_FRAME_RATES.includes(rate as GifFrameRate);
}
