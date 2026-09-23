import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useI18n, useScopedT } from "@/contexts/I18nContext";
import type { ProjectMetadata } from "./projectPersistence";
import type { ZoomRegion } from "./types";
import {
	formatChaptersText,
	parseChaptersText,
} from "@/lib/youtubeChapters";

interface AiMetadataDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	cues: Array<{ startMs: number; endMs: number; text: string }>;
	zoomRegions: ZoomRegion[];
	durationMs: number;
	videoPath: string | null;
	existingMetadata?: ProjectMetadata;
	onSaveMetadata: (metadata: ProjectMetadata) => void;
}

type Engine = "ai" | "heuristic";

/**
 * "Generate title & chapters" results modal: editable title/summary/chapters
 * with "Save to project" and "Copy YouTube chapters" actions. Results come
 * from the summarize-transcript IPC (AI engine when configured, heuristic
 * otherwise).
 */
export function AiMetadataDialog({
	open,
	onOpenChange,
	cues,
	zoomRegions,
	durationMs,
	videoPath,
	existingMetadata,
	onSaveMetadata,
}: AiMetadataDialogProps) {
	const t = useScopedT("settings");
	const { t: tGlobal } = useI18n();
	const [isGenerating, setIsGenerating] = useState(false);
	const [loadError, setLoadError] = useState<string | null>(null);
	const [engine, setEngine] = useState<Engine | null>(null);
	const [title, setTitle] = useState("");
	const [summary, setSummary] = useState("");
	const [chaptersText, setChaptersText] = useState("");

	const runSummarize = useCallback(async () => {
		setIsGenerating(true);
		setLoadError(null);
		try {
			const result = await window.electronAPI.summarizeTranscript({
				videoPath,
				cues: cues.map((cue) => ({
					startMs: cue.startMs,
					endMs: cue.endMs,
					text: cue.text,
				})),
				zoomRegions: zoomRegions.map((region) => ({
					startMs: region.startMs,
					endMs: region.endMs,
					depth: region.depth,
				})),
				durationMs,
			});
			if (!result?.success) {
				setLoadError(
					result?.error ??
						t("ai.generateFailed", "The summary could not be generated."),
				);
				return;
			}
			setEngine(result.engine ?? "heuristic");
			setTitle(result.title ?? "");
			setSummary(result.summary ?? "");
			setChaptersText(formatChaptersText(result.chapters ?? []));
		} catch {
			setLoadError(t("ai.generateFailed", "The summary could not be generated."));
		} finally {
			setIsGenerating(false);
		}
	}, [cues, durationMs, t, videoPath, zoomRegions]);

	// Kick off generation each time the dialog opens; prefill from saved
	// metadata only until the first result arrives.
	// biome-ignore lint/correctness/useExhaustiveDependencies: re-running on open is the intent; cue/zoom identity changes mid-session must not re-trigger
	useEffect(() => {
		if (!open) {
			return;
		}
		setEngine(null);
		setLoadError(null);
		if (existingMetadata) {
			setTitle(existingMetadata.title ?? "");
			setSummary(existingMetadata.summary ?? "");
			setChaptersText(formatChaptersText(existingMetadata.chapters ?? []));
		} else {
			setTitle("");
			setSummary("");
			setChaptersText("");
		}
		void runSummarize();
	}, [open]);

	const parsedChapters = useMemo(() => parseChaptersText(chaptersText), [chaptersText]);

	const buildMetadata = useCallback((): ProjectMetadata => {
		const metadata: ProjectMetadata = {};
		if (title.trim()) {
			metadata.title = title.trim();
		}
		if (summary.trim()) {
			metadata.summary = summary.trim();
		}
		if (parsedChapters.length > 0) {
			metadata.chapters = parsedChapters;
		}
		return metadata;
	}, [parsedChapters, summary, title]);

	const handleSave = useCallback(() => {
		onSaveMetadata(buildMetadata());
		toast.success(t("ai.metadataSaved", "Saved to project."));
		onOpenChange(false);
	}, [buildMetadata, onOpenChange, onSaveMetadata, t]);

	const handleCopyChapters = useCallback(async () => {
		const text = formatChaptersText(parsedChapters);
		if (!text) {
			return;
		}
		try {
			await navigator.clipboard.writeText(text);
			toast.success(t("ai.chaptersCopied", "YouTube chapters copied."));
		} catch {
			toast.error(t("ai.chaptersCopyFailed", "The chapters could not be copied."));
		}
	}, [parsedChapters, t]);

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-xl border-foreground/10 bg-editor-surface text-foreground">
				<DialogHeader>
					<DialogTitle>{t("ai.generateTitleChapters", "Generate title & chapters")}</DialogTitle>
					<DialogDescription className="text-muted-foreground">
						{isGenerating
							? t("ai.generating", "Generating...")
							: engine === "heuristic"
								? t(
										"ai.heuristicResultNote",
										"Generated from captions and zooms. Configure an AI endpoint in Settings for AI-generated results.",
									)
								: t("ai.aiResultNote", "Generated with your AI endpoint.")}
					</DialogDescription>
				</DialogHeader>

				{isGenerating ? (
					<div className="indeterminate-progress h-2 rounded-full bg-foreground/5" />
				) : (
					<div className="flex flex-col gap-3">
						{loadError ? (
							<p className="rounded-md border border-red-500/20 bg-red-500/10 px-2 py-1.5 text-xs text-red-400">
								{loadError}
							</p>
						) : null}
						<label className="flex flex-col gap-1">
							<span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
								{t("ai.titleLabel", "Title")}
							</span>
							<Input
								value={title}
								onChange={(event) => setTitle(event.target.value)}
								className="h-8 rounded-md border border-foreground/10 bg-background/60 px-2 text-xs text-foreground"
							/>
						</label>
						<label className="flex flex-col gap-1">
							<span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
								{t("ai.summaryLabel", "Summary")}
							</span>
							<textarea
								value={summary}
								rows={3}
								onChange={(event) => setSummary(event.target.value)}
								className="min-h-[4rem] w-full resize-none rounded-md border border-foreground/10 bg-background/60 px-2 py-1.5 text-xs text-foreground outline-none focus-visible:border-[#2563EB] focus-visible:ring-1 focus-visible:ring-[#2563EB]"
							/>
						</label>
						<label className="flex flex-col gap-1">
							<span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
								{t("ai.chaptersLabel", "Chapters (m:ss Title, one per line)")}
							</span>
							<textarea
								value={chaptersText}
								rows={6}
								onChange={(event) => setChaptersText(event.target.value)}
								className="min-h-[6rem] w-full resize-y rounded-md border border-foreground/10 bg-background/60 px-2 py-1.5 font-mono text-xs text-foreground outline-none focus-visible:border-[#2563EB] focus-visible:ring-1 focus-visible:ring-[#2563EB]"
							/>
						</label>
					</div>
				)}

				<DialogFooter className="gap-2">
					<Button
						type="button"
						variant="outline"
						onClick={() => void handleCopyChapters()}
						disabled={isGenerating || parsedChapters.length === 0}
						className="h-8 border-foreground/10 bg-foreground/5 text-xs text-muted-foreground hover:bg-foreground/10"
					>
						{t("ai.copyChapters", "Copy YouTube chapters")}
					</Button>
					<Button
						type="button"
						onClick={handleSave}
						disabled={isGenerating}
						className="h-8 rounded-[5px] bg-[#2563EB] text-xs font-semibold text-white hover:bg-[#2563EB]/92 disabled:opacity-60"
					>
						{t("ai.saveToProject", "Save to project")}
					</Button>
					<Button
						type="button"
						variant="outline"
						onClick={() => onOpenChange(false)}
						className="h-8 border-foreground/10 bg-foreground/5 text-xs text-muted-foreground hover:bg-foreground/10"
					>
						{tGlobal("common.actions.close", "Close")}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
