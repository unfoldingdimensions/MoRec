import {
	calculateOutputDimensions,
	type ExportBackendPreference,
	type ExportEncodingMode,
	type ExportFormat,
	type ExportMp4FrameRate,
	type ExportPipelineModel,
	type ExportQuality,
	type ExportResumableSessionRef,
	type ExportSettings,
	GIF_SIZE_PRESETS,
	type GifFrameRate,
	type GifSizePreset,
} from "@/lib/exporter";
import {
	calculateCanvasCropRect,
	type ExportCanvas,
	scaleCanvasCropRect,
} from "./exportDimensions";

export function resolveExportStartSettings({
	sourceWidth,
	sourceHeight,
	exportFormat,
	includeCaptionSidecar,
	exportEncodingMode,
	exportQuality,
	targetSizeMb,
	exportCanvas,
	mp4FrameRate,
	exportBackendPreference,
	exportPipelineModel,
	resume,
	gifFrameRate,
	gifLoop,
	gifSizePreset,
}: {
	sourceWidth: number;
	sourceHeight: number;
	exportFormat: ExportFormat;
	includeCaptionSidecar: boolean;
	exportEncodingMode: ExportEncodingMode;
	exportQuality: ExportQuality;
	targetSizeMb: number;
	exportCanvas: ExportCanvas;
	mp4FrameRate: ExportMp4FrameRate;
	exportBackendPreference: ExportBackendPreference;
	exportPipelineModel: ExportPipelineModel;
	resume?: ExportResumableSessionRef;
	gifFrameRate: GifFrameRate;
	gifLoop: boolean;
	gifSizePreset: GifSizePreset;
}): ExportSettings {
	// Canvas applies first (center-crop at source scale), then the GIF size
	// preset scales the cropped frame. The composition canvas itself stays at
	// the uncropped preset size; GifExporter crops at capture with a rect
	// rescaled into that composition space.
	const composeDimensions = calculateOutputDimensions(
		sourceWidth,
		sourceHeight,
		gifSizePreset,
		GIF_SIZE_PRESETS,
	);
	const sourceCropRect =
		exportFormat === "gif" ? calculateCanvasCropRect(sourceWidth, sourceHeight, exportCanvas) : null;
	const gifCropRect = sourceCropRect
		? scaleCanvasCropRect(sourceCropRect, {
				fromWidth: sourceWidth,
				fromHeight: sourceHeight,
				toWidth: composeDimensions.width,
				toHeight: composeDimensions.height,
			})
		: null;
	const gifDimensions = gifCropRect ?? composeDimensions;

	return {
		format: exportFormat,
		includeCaptionSidecar: exportFormat === "mp4" ? includeCaptionSidecar : false,
		encodingMode: exportFormat === "mp4" ? exportEncodingMode : undefined,
		mp4FrameRate: exportFormat === "mp4" ? mp4FrameRate : undefined,
		backendPreference: exportFormat === "mp4" ? exportBackendPreference : undefined,
		pipelineModel: exportFormat === "mp4" ? exportPipelineModel : undefined,
		quality: exportFormat === "mp4" ? exportQuality : undefined,
		targetSizeMb: exportFormat === "mp4" ? targetSizeMb : undefined,
		canvas: exportFormat === "mp4" ? exportCanvas : undefined,
		resume: exportFormat === "mp4" && exportPipelineModel === "modern" ? resume : undefined,
		gifConfig:
			exportFormat === "gif" && gifDimensions
				? {
						frameRate: gifFrameRate,
						loop: gifLoop,
						sizePreset: gifSizePreset,
						width: gifDimensions.width,
						height: gifDimensions.height,
						canvas: exportCanvas,
					}
				: undefined,
	};
}
