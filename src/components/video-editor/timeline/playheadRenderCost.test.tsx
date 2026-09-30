// @vitest-environment jsdom
import { act } from "@testing-library/react";
import { Profiler } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/contexts/I18nContext";
import { ShortcutsProvider } from "@/contexts/ShortcutsContext";
import type { ClipRegion, ZoomRegion } from "../types";
import TimelineEditor from "./TimelineEditor";

// WaveformGenerator constructs an AudioContext at module evaluation; jsdom has
// none, and this test drives the timeline with no audio sidecars anyway.
vi.mock("@/components/video-editor/audio/waveform/WaveformGenerator", () => ({
	waveformGenerator: {
		generate: vi.fn(async () => null),
	},
}));

class ResizeObserverStub {
	observe() {}
	unobserve() {}
	disconnect() {}
}

const ZOOM_REGION_COUNT = 400;
const TICK_COUNT = 40;
/** Post-fix each playhead tick commits only the playhead/canvas body. A full
 * region-tree re-render at this scale measured ~300 ms/tick pre-fix. */
const MAX_TICK_ACTUAL_DURATION_MS = 25;

function buildRegions() {
	const zoomRegions: ZoomRegion[] = Array.from({ length: ZOOM_REGION_COUNT }, (_, i) => ({
		id: `zoom-${i}`,
		startMs: i * 12_000 + 6_000,
		endMs: i * 12_000 + 10_000,
		depth: ((i % 6) + 1) as ZoomRegion["depth"],
		focus: { cx: 0.5, cy: 0.5 },
	}));
	const clipRegions: ClipRegion[] = [
		{ id: "clip-1", startMs: 0, endMs: 40 * 60 * 1_000, speed: 1 },
	];
	return { zoomRegions, clipRegions };
}

describe("TimelineEditor playhead render cost", () => {
	let container: HTMLDivElement | null = null;
	let root: Root | null = null;

	beforeEach(() => {
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container!);
		const ownerWindow = window as unknown as {
			ResizeObserver?: typeof ResizeObserver;
		};
		ownerWindow.ResizeObserver ??=
			ResizeObserverStub as unknown as typeof ResizeObserver;
	});

	afterEach(() => {
		act(() => {
			root?.unmount();
		});
		container?.remove();
		container = null;
		root = null;
	});

	it("advances the playhead without re-rendering the region tree", { timeout: 240_000 }, async () => {
		const { zoomRegions, clipRegions } = buildRegions();
		// Stable across renders, like the production useCallback'd handlers and
		// state-backed region arrays in VideoEditor — an inline arrow or a
		// defaulted empty array here would churn the rows props itself.
		const noop = () => undefined;
		const emptyRegions: never[] = [];
		let tickDurations: number[] = [];

		function App({ currentTime }: { currentTime: number }) {
			return (
				<I18nProvider>
					<ShortcutsProvider>
						<Profiler
							id="timeline"
							onRender={(_id, _phase, actualDuration) => {
								tickDurations.push(actualDuration);
							}}
						>
							<div style={{ height: 600 }}>
								<TimelineEditor
									videoDuration={40 * 60}
									currentTime={currentTime}
									zoomRegions={zoomRegions}
									trimRegions={emptyRegions}
									clipRegions={clipRegions}
									annotationRegions={emptyRegions}
									speedRegions={emptyRegions}
									audioRegions={emptyRegions}
									captionRegions={emptyRegions}
									onZoomAdded={noop}
									onZoomSpanChange={noop}
									onZoomDelete={noop}
									selectedZoomId={null}
									onSelectZoom={noop}
									onClipSpanChange={noop}
									onSelectClip={noop}
								/>
							</div>
						</Profiler>
					</ShortcutsProvider>
				</I18nProvider>
			);
		}

		await act(async () => {
			root!.render(<App currentTime={0} />);
		});

		// Drive the playhead like playback does: one update per animation frame.
		tickDurations = [];
		for (let tick = 1; tick <= TICK_COUNT; tick += 1) {
			await act(async () => {
				root!.render(<App currentTime={tick * 0.033} />);
			});
		}

		// The playhead must still commit on every tick — memoization must not
		// freeze the timeline.
		expect(tickDurations.length).toBe(TICK_COUNT);

		const heaviestTickMs = Math.max(...tickDurations);
		expect(heaviestTickMs).toBeLessThan(MAX_TICK_ACTUAL_DURATION_MS);
	});
});
