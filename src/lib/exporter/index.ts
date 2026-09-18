export { FrameRenderer } from "./frameRenderer";
export {
	calculateOutputDimensions,
	GifExporter,
	resolveGifCanvasComposition,
} from "./gifExporter";
export {
	getMp4ExportBitrate,
	getSourceQualityBitrate,
	getTargetSizeExportBitrate,
	normalizeTargetSizeMb,
	TARGET_SIZE_CONTAINER_OVERHEAD_FACTOR,
	TARGET_SIZE_VIDEO_BITRATE_SHARE,
} from "./exportBitrate";
export { ModernVideoExporter } from "./modernVideoExporter";
export type {
	SupportedMp4Dimensions,
	SupportedMp4EncoderPath,
} from "./mp4Support";
export {
	DEFAULT_MP4_CODEC,
	MP4_CODEC_FALLBACK_LIST,
	probeSupportedMp4Dimensions,
	resolveSupportedMp4EncoderPath,
} from "./mp4Support";
export { VideoMuxer } from "./muxer";
export { StreamingVideoDecoder } from "./streamingDecoder";
export type {
	ExportBackendPreference,
	ExportConfig,
	ExportEncodeBackend,
	ExportEncodingMode,
	ExportFormat,
	ExportMetrics,
	ExportMp4FrameRate,
	ExportPipelineModel,
	ExportProgress,
	ExportQuality,
	ExportRenderBackend,
	ExportResumableSessionRef,
	ExportResult,
	ExportSettings,
	GifExportConfig,
	GifFrameRate,
	GifSizePreset,
	VideoFrameData,
} from "./types";
export {
	GIF_FRAME_RATES,
	GIF_SIZE_PRESETS,
	isValidGifFrameRate,
	isValidMp4FrameRate,
	MP4_FRAME_RATES,
	VALID_GIF_FRAME_RATES,
} from "./types";
export type { CanvasCropRect, ExportCanvas } from "@/components/video-editor/exportDimensions";
export {
	calculateCanvasCropRect,
	EXPORT_CANVAS_PRESETS,
	getCanvasCropOutputSize,
	normalizeExportCanvas,
	scaleCanvasCropRect,
} from "@/components/video-editor/exportDimensions";
export { VideoFileDecoder } from "./videoDecoder";
export { VideoExporter } from "./videoExporter";
