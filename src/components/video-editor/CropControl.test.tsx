// @vitest-environment jsdom
import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CropControl } from "./CropControl";

function makeVideoElement() {
	const video = {
		videoWidth: 1920,
		videoHeight: 1080,
		readyState: 2,
	};
	return video as unknown as HTMLVideoElement;
}

function renderCrop(cropRegion = { x: 0.2, y: 0.2, width: 0.4, height: 0.4 }) {
	const props = {
		videoElement: makeVideoElement(),
		cropRegion,
		onCropChange: vi.fn(),
	};
	const view = render(<CropControl {...props} />);
	const container = view.container.firstElementChild?.firstElementChild as HTMLElement;
	// jsdom reports zero rects; give the mock container a real size so the
	// normalized pointer math has something to work with
	container.getBoundingClientRect = () =>
		({ left: 0, top: 0, width: 1000, height: 1000, right: 1000, bottom: 1000 }) as DOMRect;
	return { ...view, props, container };
}

describe("CropControl", () => {
	it("moves the crop region when dragging the interior surface", () => {
		const { props, container } = renderCrop();

		const surface = container.querySelector<HTMLElement>('[data-testid="crop-move-surface"]');
		expect(surface).not.toBeNull();

		fireEvent.pointerDown(surface!, {
			clientX: 400,
			clientY: 400,
			pointerId: 1,
		});
		fireEvent.pointerMove(container, {
			clientX: 550,
			clientY: 460,
			pointerId: 1,
		});
		fireEvent.pointerUp(container, { pointerId: 1 });

		expect(props.onCropChange).toHaveBeenLastCalledWith(
			expect.objectContaining({
				x: expect.closeTo(0.35),
				y: expect.closeTo(0.26),
				width: 0.4,
				height: 0.4,
			}),
		);
	});

	it("clamps the moved region inside the video bounds", () => {
		const { props, container } = renderCrop({ x: 0.5, y: 0.5, width: 0.4, height: 0.4 });

		const surface = container.querySelector<HTMLElement>('[data-testid="crop-move-surface"]');
		fireEvent.pointerDown(surface!, {
			clientX: 700,
			clientY: 700,
			pointerId: 1,
		});
		// drag far beyond the bottom-right corner — clamps to x+y+width/height = 1
		fireEvent.pointerMove(container, {
			clientX: 5000,
			clientY: 5000,
			pointerId: 1,
		});

		expect(props.onCropChange).toHaveBeenLastCalledWith({
			x: 0.6,
			y: 0.6,
			width: 0.4,
			height: 0.4,
		});
	});
});
