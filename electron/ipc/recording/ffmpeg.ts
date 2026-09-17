import type { SelectedSource } from "../types";
import { getScreen } from "../utils";
import { resolveWindowsCaptureDisplay } from "../windowsCaptureSelection";

// Callers here only need geometry hints for ffmpeg crop filters; when the
// selected display is gone the primary display's geometry is the least-wrong
// fallback (the native capture path treats this case as a hard failure).
export function getDisplayBoundsForSource(source: SelectedSource) {
	const resolved =
		resolveWindowsCaptureDisplay(
			source,
			getScreen().getAllDisplays(),
			getScreen().getPrimaryDisplay(),
		) ?? null;
	return resolved?.bounds ?? getScreen().getPrimaryDisplay().bounds;
}

export function getDisplayWorkAreaForSource(source: SelectedSource) {
	const allDisplays = getScreen().getAllDisplays();
	const primaryDisplay = getScreen().getPrimaryDisplay();
	const resolved = resolveWindowsCaptureDisplay(source, allDisplays, primaryDisplay);
	const matched = resolved
		? (allDisplays.find((d) => d.id === resolved.displayId) ?? primaryDisplay)
		: primaryDisplay;
	return matched.workArea;
}
