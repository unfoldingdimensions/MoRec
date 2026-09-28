import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useScopedT } from "@/contexts/I18nContext";
import type { MultiClipRange } from "./timeline/multiClipMarks";

interface MultiClipPanelProps {
	open: boolean;
	ranges: MultiClipRange[];
	onApply: (ranges: MultiClipRange[]) => void;
	onDismiss: () => void;
}

function formatRangeTime(ms: number): string {
	const totalSeconds = Math.max(0, Math.floor(ms / 1000));
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/**
 * One-time "Multi-clip recording" panel shown when the just-opened recording
 * carries HUD marks. Lists every take [start → end] with a Keep/Discard
 * toggle (the take ending at each mark is discarded by default); applying
 * cuts the discarded takes through the silence-removal pipeline.
 */
export function MultiClipPanel({ open, ranges, onApply, onDismiss }: MultiClipPanelProps) {
	const t = useScopedT("editor");
	const [overrides, setOverrides] = useState<Record<number, boolean>>({});

	// Reset toggles whenever a new mark set opens the panel.
	const key = ranges.map((range) => `${range.startMs}-${range.endMs}`).join("|");
	const [lastKey, setLastKey] = useState(key);
	if (key !== lastKey) {
		setLastKey(key);
		setOverrides({});
	}

	const effectiveRanges = useMemo(
		() => ranges.map((range, index) => ({ ...range, discard: overrides[index] ?? range.discard })),
		[overrides, ranges],
	);
	const discardCount = effectiveRanges.filter((range) => range.discard).length;
	const discardedSeconds = Math.round(
		effectiveRanges.reduce(
			(sum, range) => sum + (range.discard ? range.endMs - range.startMs : 0),
			0,
		) / 1000,
	);

	return (
		<Dialog open={open} onOpenChange={(next) => { if (!next) onDismiss(); }}>
			<DialogContent className="max-w-md border-foreground/10 bg-editor-surface text-foreground">
				<DialogHeader>
					<DialogTitle>{t("multiClip.multiClipRecording", "Multi-clip recording")}</DialogTitle>
				</DialogHeader>
				<p className="text-xs leading-relaxed text-muted-foreground">
					{t(
						"editor.multiClip.hint",
						"Marks split the recording; toggle the ranges to discard.",
					)}
				</p>
				<div className="flex max-h-64 flex-col gap-1.5 overflow-y-auto custom-scrollbar">
					{effectiveRanges.map((range, index) => (
						<div
							key={`${range.startMs}-${range.endMs}`}
							className="flex items-center justify-between gap-3 rounded-lg bg-foreground/[0.03] px-2.5 py-2"
						>
							<span className="font-mono text-xs tabular-nums text-foreground">
								{t("editor.multiClip.takeRange", "{{start}} → {{end}}", {
									start: formatRangeTime(range.startMs),
									end: formatRangeTime(range.endMs),
								})}
							</span>
							<div className="flex items-center gap-1.5">
								<Button
									type="button"
									size="sm"
									onClick={() => setOverrides((prev) => ({ ...prev, [index]: true }))}
									className={
										range.discard
											? "h-7 rounded-md border border-red-500/20 bg-red-500/10 px-2.5 text-xs font-medium text-red-400"
											: "h-7 rounded-md border border-foreground/10 bg-foreground/5 px-2.5 text-xs text-muted-foreground hover:bg-foreground/10"
									}
								>
									{t("editor.multiClip.discardRange", "Discard")}
								</Button>
								<Button
									type="button"
									size="sm"
									onClick={() => setOverrides((prev) => ({ ...prev, [index]: false }))}
									className={
										!range.discard
											? "h-7 rounded-md border border-emerald-500/20 bg-emerald-500/10 px-2.5 text-xs font-medium text-emerald-400"
											: "h-7 rounded-md border border-foreground/10 bg-foreground/5 px-2.5 text-xs text-muted-foreground hover:bg-foreground/10"
									}
								>
									{t("editor.multiClip.keepRange", "Keep")}
								</Button>
							</div>
						</div>
					))}
				</div>
				<DialogFooter className="gap-2">
					<Button
						type="button"
						variant="outline"
						onClick={onDismiss}
						className="h-8 border-foreground/10 bg-foreground/5 text-xs text-muted-foreground hover:bg-foreground/10"
					>
						{t("editor.multiClip.dismiss", "Not now")}
					</Button>
					<Button
						type="button"
						onClick={() => onApply(effectiveRanges)}
						disabled={discardCount === 0}
						className="h-8 rounded-[5px] bg-[#2563EB] text-xs font-semibold text-white hover:bg-[#2563EB]/92 disabled:opacity-60"
					>
						{discardCount > 0
							? t("editor.multiClip.applyMultiClip", "Cut {{count}} range(s) ({{seconds}}s)", {
									count: discardCount,
									seconds: discardedSeconds,
								})
							: t("editor.multiClip.applyMultiClip", "Apply cuts")}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
