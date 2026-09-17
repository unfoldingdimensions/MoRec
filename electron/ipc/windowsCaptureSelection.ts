export type WindowsCaptureSourceLike = {
	id?: string;
	display_id?: string;
	sourceType?: string;
};

export type WindowsCaptureDisplayBounds = {
	x: number;
	y: number;
	width: number;
	height: number;
};

export type WindowsCaptureDisplayLike = {
	id: number;
	bounds: WindowsCaptureDisplayBounds;
	scaleFactor?: number;
};

export type ResolvedWindowsCaptureDisplay = {
	displayId: number;
	bounds: WindowsCaptureDisplayBounds;
	scaleFactor: number;
};

export type ResolvedWindowsCaptureTarget =
	| {
			kind: "window";
			windowHandle: number;
	  }
	| {
			kind: "display";
			displayId: number;
			bounds: WindowsCaptureDisplayBounds;
			scaleFactor: number;
	  }
	| {
			kind: "invalid-window";
	  }
	| {
			kind: "invalid-display";
	  };

function parseDesktopCapturerWindowHandle(sourceId?: string) {
	if (!sourceId) {
		return null;
	}

	const match = sourceId.match(/^window:(\d+)/);
	if (!match) {
		return null;
	}

	const handle = Number.parseInt(match[1], 10);
	return Number.isFinite(handle) && handle > 0 ? handle : null;
}

function isWindowCaptureSource(source: WindowsCaptureSourceLike | null | undefined) {
	return source?.sourceType === "window" || source?.id?.startsWith("window:") === true;
}

export function resolveWindowsCaptureDisplay(
	source: WindowsCaptureSourceLike | null | undefined,
	allDisplays: WindowsCaptureDisplayLike[],
	primaryDisplay: WindowsCaptureDisplayLike,
): ResolvedWindowsCaptureDisplay | null {
	const requestedDisplayId = Number(source?.display_id);
	const primaryDisplayId = Number(primaryDisplay.id);
	const hasRequestedDisplayId = Number.isFinite(requestedDisplayId) && requestedDisplayId > 0;
	const requestedOrPrimaryDisplayId = hasRequestedDisplayId ? requestedDisplayId : primaryDisplayId;

	const matchedDisplay = allDisplays.find(
		(display) => String(display.id) === String(requestedOrPrimaryDisplayId),
	);

	// A display_id that no longer matches any live display means the monitor
	// was unplugged/disabled since selection. Failing explicitly beats the old
	// behavior of recording the primary while reporting the stale id.
	if (!matchedDisplay) {
		return null;
	}

	return {
		displayId: requestedOrPrimaryDisplayId,
		bounds: matchedDisplay.bounds,
		scaleFactor: matchedDisplay.scaleFactor ?? 1,
	};
}

export function resolveWindowsCaptureTarget(
	source: WindowsCaptureSourceLike | null | undefined,
	allDisplays: WindowsCaptureDisplayLike[],
	primaryDisplay: WindowsCaptureDisplayLike,
): ResolvedWindowsCaptureTarget {
	if (isWindowCaptureSource(source)) {
		const windowHandle = parseDesktopCapturerWindowHandle(source?.id);
		if (windowHandle !== null) {
			return {
				kind: "window",
				windowHandle,
			};
		}

		return {
			kind: "invalid-window",
		};
	}

	const resolvedDisplay = resolveWindowsCaptureDisplay(source, allDisplays, primaryDisplay);
	if (!resolvedDisplay) {
		return {
			kind: "invalid-display",
		};
	}
	return {
		kind: "display",
		...resolvedDisplay,
	};
}
