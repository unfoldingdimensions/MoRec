import type { SelectedSource } from "../types";
import { getScreen } from "../utils";
import { resolveWindowsCaptureDisplay } from "../windowsCaptureSelection";

export function getDisplayBoundsForSource(source: SelectedSource) {
	return resolveWindowsCaptureDisplay(
		source,
		getScreen().getAllDisplays(),
		getScreen().getPrimaryDisplay(),
	).bounds;
}

export function getDisplayWorkAreaForSource(source: SelectedSource) {
	const allDisplays = getScreen().getAllDisplays();
	const primaryDisplay = getScreen().getPrimaryDisplay();
	const { displayId } = resolveWindowsCaptureDisplay(source, allDisplays, primaryDisplay);
	const matched = allDisplays.find((d) => d.id === displayId) ?? primaryDisplay;
	return matched.workArea;
}
