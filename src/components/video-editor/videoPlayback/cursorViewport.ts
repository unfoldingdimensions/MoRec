import type { CropRegion, CursorTelemetryPoint } from "../types";

const CURSOR_VIEWPORT_EPSILON = 0.000001;

export interface CursorViewportRect {
	x: number;
	y: number;
	width: number;
	height: number;
	renderWidth?: number;
	renderHeight?: number;
	sourceCrop?: CropRegion;
}

export interface ProjectedCursorPosition {
	cx: number;
	cy: number;
	visible: boolean;
}

export function projectCursorPositionToViewport(
	position: { cx: number; cy: number },
	sourceCrop?: CropRegion,
): ProjectedCursorPosition {
	if (!sourceCrop) {
		return {
			cx: position.cx,
			cy: position.cy,
			visible: true,
		};
	}

	const cropWidth = sourceCrop.width;
	const cropHeight = sourceCrop.height;

	if (cropWidth <= 0 || cropHeight <= 0) {
		return {
			cx: position.cx,
			cy: position.cy,
			visible: false,
		};
	}

	const projectedX = (position.cx - sourceCrop.x) / cropWidth;
	const projectedY = (position.cy - sourceCrop.y) / cropHeight;
	const visible =
		projectedX >= -CURSOR_VIEWPORT_EPSILON &&
		projectedX <= 1 + CURSOR_VIEWPORT_EPSILON &&
		projectedY >= -CURSOR_VIEWPORT_EPSILON &&
		projectedY <= 1 + CURSOR_VIEWPORT_EPSILON;

	return {
		cx: projectedX,
		cy: projectedY,
		visible,
	};
}

function isDefaultCropRegion(sourceCrop: CropRegion): boolean {
	return (
		sourceCrop.x === 0 &&
		sourceCrop.y === 0 &&
		sourceCrop.width === 1 &&
		sourceCrop.height === 1
	);
}

/**
 * Projects raw source-normalized cursor telemetry into crop-viewport
 * (content) coordinates for the cursor-follow camera, whose focus is
 * interpreted within the cropped content rect by computeZoomTransform. With a
 * default (full-frame) crop the input array is returned untouched.
 */
export function buildCursorFollowTelemetry(
	cursorSamples: CursorTelemetryPoint[],
	sourceCrop: CropRegion | undefined | null,
): CursorTelemetryPoint[] {
	if (!sourceCrop || isDefaultCropRegion(sourceCrop)) {
		return cursorSamples;
	}

	return cursorSamples.map((sample) => {
		const projected = projectCursorPositionToViewport(sample, sourceCrop);
		return { ...sample, cx: projected.cx, cy: projected.cy };
	});
}
