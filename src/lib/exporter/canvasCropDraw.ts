import type { CanvasCropRect } from "@/components/video-editor/exportDimensions";

/**
 * Applies a social-canvas center-crop at frame-capture time: draws the crop
 * rect out of the full composition into a cache canvas sized to the final
 * output. Both WebCodecs frame renderers call this from `getCanvas()` so
 * encoded frames (and the encoder config) use the crop size while the
 * composition itself still renders full-size — the crop composes after zoom.
 */
export class CanvasCropApplier {
	private canvas: HTMLCanvasElement | null = null;
	private context: CanvasRenderingContext2D | null = null;

	apply(source: HTMLCanvasElement, crop: CanvasCropRect | undefined | null): HTMLCanvasElement {
		if (!crop) {
			return source;
		}
		if (
			!this.canvas ||
			this.canvas.width !== crop.width ||
			this.canvas.height !== crop.height
		) {
			this.canvas = document.createElement("canvas");
			this.canvas.width = crop.width;
			this.canvas.height = crop.height;
			this.context = this.canvas.getContext("2d");
		}
		if (!this.context) {
			return source;
		}
		this.context.drawImage(
			source,
			crop.x,
			crop.y,
			crop.width,
			crop.height,
			0,
			0,
			crop.width,
			crop.height,
		);
		return this.canvas;
	}

	dispose(): void {
		this.canvas = null;
		this.context = null;
	}
}
