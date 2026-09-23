import { ArrowsMerge, Scissors, Trash } from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useScopedT } from "@/contexts/I18nContext";
import { normalizeCaptionWords } from "./captionEditing";
import type { CaptionRetimeSpan } from "./captionOps";
import type { TranscriptCutWordSpan } from "./timeline/transcriptCutting";
import type { CaptionCue, CaptionCueWord } from "./types";

interface CaptionListPanelProps {
	cues: CaptionCue[];
	selectedCaptionId: string | null;
	currentTimeMs: number;
	onBeginCaptionEdit: (id: string) => void;
	onCaptionTextEdit: (id: string, text: string) => void;
	onCaptionRetime: (id: string, span: CaptionRetimeSpan) => void;
	onCaptionSplit: (id: string, atMs: number) => void;
	onCaptionMerge: (idA: string, idB: string) => void;
	onCaptionDelete: (id: string) => void;
	/**
	 * Cut the selected transcript word spans out of the video. Returns whether
	 * the cut was applied (the panel clears its selection when it was).
	 */
	onCutTranscriptWords?: (wordSpans: TranscriptCutWordSpan[]) => boolean;
}

function clampNumber(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

function formatTimecode(ms: number): string {
	const safeMs = Math.max(0, Math.round(ms));
	const minutes = Math.floor(safeMs / 60_000);
	const seconds = Math.floor((safeMs % 60_000) / 1_000);
	const millis = safeMs % 1_000;
	return `${minutes}:${String(seconds).padStart(2, "0")}.${String(millis).padStart(3, "0")}`;
}

function parseTimecode(value: string): number | null {
	const match = value.trim().match(/^(?:(\d+):)?(\d{1,2})(?:\.(\d{1,3}))?$/);
	if (!match) {
		return null;
	}
	const minutes = match[1] ? Number.parseInt(match[1], 10) : 0;
	const seconds = Number.parseInt(match[2], 10);
	const millis = match[3] ? Number.parseInt(match[3].padEnd(3, "0"), 10) : 0;
	return (minutes * 60 + seconds) * 1_000 + millis;
}

// Mirrors splitCue's word source: explicit words when present, otherwise tokens
// derived from the text. A cue with fewer than two words cannot be split.
function getCueSplitWordCount(cue: CaptionCue): number {
	if (Array.isArray(cue.words) && cue.words.length > 0) {
		return cue.words.filter((word) => word.text.trim().length > 0).length;
	}
	return cue.text.trim().match(/\S+/g)?.length ?? 0;
}

interface CaptionEditorProps {
	cue: CaptionCue;
	canMerge: boolean;
	currentTimeMs: number;
	onBeginEdit: (id: string) => void;
	onTextEdit: (id: string, text: string) => void;
	onRetime: (id: string, span: CaptionRetimeSpan) => void;
	onSplit: (id: string, atMs: number) => void;
	onMerge: (id: string) => void;
	onDelete: (id: string) => void;
}

function CaptionEditor({
	cue,
	canMerge,
	currentTimeMs,
	onBeginEdit,
	onTextEdit,
	onRetime,
	onSplit,
	onMerge,
	onDelete,
}: CaptionEditorProps) {
	const t = useScopedT("settings");
	const [draftText, setDraftText] = useState(cue.text);
	const [startValue, setStartValue] = useState(formatTimecode(cue.startMs));
	const [endValue, setEndValue] = useState(formatTimecode(cue.endMs));
	const canSplit = getCueSplitWordCount(cue) >= 2;
	// Escape resets the draft and blurs, but `setDraftText` is batched so the blur-driven
	// `commitText` would still see the stale (edited) draft and save it. This flag lets the
	// cancel path tell the next blur to discard instead of commit.
	const cancelNextCommitRef = useRef(false);

	useEffect(() => {
		setDraftText(cue.text);
		setStartValue(formatTimecode(cue.startMs));
		setEndValue(formatTimecode(cue.endMs));
	}, [cue.text, cue.startMs, cue.endMs]);

	const commitText = useCallback(() => {
		if (cancelNextCommitRef.current) {
			cancelNextCommitRef.current = false;
			setDraftText(cue.text);
			return;
		}
		const normalized = draftText.trim();
		if (normalized && normalized !== cue.text) {
			onTextEdit(cue.id, normalized);
		} else {
			if (!normalized && cue.text) {
				// Empty cues are dropped by the project loader, so clearing is not
				// allowed — tell the user instead of silently reverting.
				toast.info(t("captions.editor.cannotBeEmpty", "Caption text can't be empty"));
			}
			setDraftText(cue.text);
		}
	}, [cue.id, cue.text, draftText, onTextEdit, t]);

	const commitTiming = useCallback(() => {
		const parsedStart = parseTimecode(startValue);
		const parsedEnd = parseTimecode(endValue);
		if (parsedStart === null || parsedEnd === null || parsedEnd <= parsedStart) {
			setStartValue(formatTimecode(cue.startMs));
			setEndValue(formatTimecode(cue.endMs));
			return;
		}
		if (parsedStart !== cue.startMs || parsedEnd !== cue.endMs) {
			onRetime(cue.id, { startMs: parsedStart, endMs: parsedEnd });
		}
	}, [cue.endMs, cue.id, cue.startMs, endValue, onRetime, startValue]);

	return (
		<div className="flex flex-col gap-3 rounded-lg bg-foreground/[0.03] px-2.5 py-2.5">
			<label className="flex flex-col gap-1">
				<span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
					{t("captions.editor.text", "Text")}
				</span>
				<textarea
					value={draftText}
					rows={3}
					// Freshly-added captions start empty — focus the field so the
					// user can type immediately after dropping one on the timeline.
					autoFocus={cue.text === ""}
					onFocus={() => onBeginEdit(cue.id)}
					onChange={(event) => setDraftText(event.target.value)}
					onBlur={commitText}
					onKeyDown={(event) => {
						if (event.key === "Enter" && !event.shiftKey) {
							event.preventDefault();
							event.currentTarget.blur();
						}
						if (event.key === "Escape") {
							cancelNextCommitRef.current = true;
							setDraftText(cue.text);
							event.currentTarget.blur();
						}
					}}
					className="min-h-[4.5rem] w-full resize-none rounded-md border border-foreground/10 bg-background/60 px-2 py-1.5 text-sm text-foreground outline-none focus-visible:border-[#2563EB] focus-visible:ring-1 focus-visible:ring-[#2563EB]"
				/>
			</label>

			<div className="flex items-center gap-2">
				<label className="flex flex-1 flex-col gap-1">
					<span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
						{t("captions.editor.start", "Start")}
					</span>
					<input
						value={startValue}
						onChange={(event) => setStartValue(event.target.value)}
						onBlur={commitTiming}
						onKeyDown={(event) => {
							if (event.key === "Enter") {
								event.currentTarget.blur();
							}
						}}
						className="w-full rounded-md border border-foreground/10 bg-background/60 px-2 py-1 font-mono text-xs tabular-nums text-foreground outline-none focus-visible:border-[#2563EB] focus-visible:ring-1 focus-visible:ring-[#2563EB]"
					/>
				</label>
				<label className="flex flex-1 flex-col gap-1">
					<span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
						{t("captions.editor.end", "End")}
					</span>
					<input
						value={endValue}
						onChange={(event) => setEndValue(event.target.value)}
						onBlur={commitTiming}
						onKeyDown={(event) => {
							if (event.key === "Enter") {
								event.currentTarget.blur();
							}
						}}
						className="w-full rounded-md border border-foreground/10 bg-background/60 px-2 py-1 font-mono text-xs tabular-nums text-foreground outline-none focus-visible:border-[#2563EB] focus-visible:ring-1 focus-visible:ring-[#2563EB]"
					/>
				</label>
			</div>

			<div className="grid grid-cols-3 gap-2">
				<button
					type="button"
					disabled={!canSplit}
					onClick={() =>
						onSplit(cue.id, clampNumber(currentTimeMs, cue.startMs, cue.endMs))
					}
					className="flex h-9 items-center justify-center gap-1.5 rounded-lg border border-foreground/10 bg-foreground/5 text-xs font-medium text-foreground transition-colors hover:bg-foreground/10 disabled:opacity-40"
				>
					<Scissors className="h-4 w-4" />
					{t("captions.editor.split", "Split")}
				</button>
				<button
					type="button"
					disabled={!canMerge}
					onClick={() => onMerge(cue.id)}
					className="flex h-9 items-center justify-center gap-1.5 rounded-lg border border-foreground/10 bg-foreground/5 text-xs font-medium text-foreground transition-colors hover:bg-foreground/10 disabled:opacity-40"
				>
					<ArrowsMerge className="h-4 w-4" />
					{t("captions.editor.merge", "Merge")}
				</button>
				<Button
					type="button"
					variant="destructive"
					size="sm"
					onClick={() => onDelete(cue.id)}
					className="h-9 gap-1.5 rounded-lg border border-red-500/20 bg-red-500/10 text-xs text-red-400 transition-all hover:border-red-500/30 hover:bg-red-500/20"
				>
					<Trash className="h-3 w-3" />
					{t("captions.editor.delete", "Delete")}
				</Button>
			</div>
		</div>
	);
}

function wordSelectionKey(word: Pick<CaptionCueWord, "startMs" | "endMs">): string {
	return `${word.startMs}-${word.endMs}`;
}

interface TranscriptCutViewProps {
	cue: CaptionCue;
	selectedWordSpans: ReadonlyMap<string, TranscriptCutWordSpan>;
	selectedWordCount: number;
	selectedSeconds: number;
	canCut: boolean;
	onToggleWord: (word: CaptionCueWord) => void;
	onCut: () => void;
}

/**
 * Cut-mode replacement for the caption editor: per-word click selection on
 * the selected cue. Selection state is owned by the parent so it survives
 * switching cues (selections merge across cues).
 */
function TranscriptCutView({
	cue,
	selectedWordSpans,
	selectedWordCount,
	selectedSeconds,
	canCut,
	onToggleWord,
	onCut,
}: TranscriptCutViewProps) {
	const t = useScopedT("settings");
	const words = normalizeCaptionWords(cue);

	return (
		<div className="flex flex-col gap-3 rounded-lg bg-foreground/[0.03] px-2.5 py-2.5">
			<span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
				{t(
					"captions.cutModeHint",
					"Click words to mark them for cutting. The selection carries across cues.",
				)}
			</span>
			<div className="flex flex-wrap gap-1">
				{words.map((word, index) => {
					const selected = selectedWordSpans.has(wordSelectionKey(word));
					return (
						<button
							key={`${wordSelectionKey(word)}-${index}`}
							type="button"
							aria-pressed={selected}
							onClick={() => onToggleWord(word)}
							className={
								selected
									? "rounded-md border border-red-500/40 bg-red-500/20 px-1.5 py-0.5 text-sm text-red-400 transition-colors hover:bg-red-500/30"
									: "rounded-md border border-foreground/10 bg-foreground/5 px-1.5 py-0.5 text-sm text-foreground transition-colors hover:bg-foreground/10"
							}
						>
							{word.text}
						</button>
					);
				})}
			</div>
			<Button
				type="button"
				variant="destructive"
				size="sm"
				disabled={selectedWordCount === 0 || !canCut}
				onClick={onCut}
				className="h-9 gap-1.5 rounded-lg border border-red-500/20 bg-red-500/10 text-xs text-red-400 transition-all hover:border-red-500/30 hover:bg-red-500/20"
			>
				<Scissors className="h-3 w-3" />
				{t("captions.cutSelectedWords", "Cut {{count}} words ({{seconds}}s)", {
					count: selectedWordCount,
					seconds: selectedSeconds,
				})}
			</Button>
		</div>
	);
}

export default function CaptionListPanel({
	cues,
	selectedCaptionId,
	currentTimeMs,
	onBeginCaptionEdit,
	onCaptionTextEdit,
	onCaptionRetime,
	onCaptionSplit,
	onCaptionMerge,
	onCaptionDelete,
	onCutTranscriptWords,
}: CaptionListPanelProps) {
	const t = useScopedT("settings");
	const [cutMode, setCutMode] = useState(false);
	// Keyed by word source-time span so the selection survives cue switches
	// and cue splits; spans are pruned against the live cue words below.
	const [selectedWordSpans, setSelectedWordSpans] = useState<
		ReadonlyMap<string, TranscriptCutWordSpan>
	>(() => new Map());

	const index = cues.findIndex((cue) => cue.id === selectedCaptionId);
	const cue = index >= 0 ? cues[index] : null;

	const validWordKeys = useMemo(() => {
		const keys = new Set<string>();
		for (const cueValue of cues) {
			for (const word of normalizeCaptionWords(cueValue)) {
				keys.add(wordSelectionKey(word));
			}
		}
		return keys;
	}, [cues]);

	const activeSelectedSpans = useMemo(
		() =>
			Array.from(selectedWordSpans.entries())
				.filter(([key]) => validWordKeys.has(key))
				.map(([, wordSpan]) => wordSpan),
		[selectedWordSpans, validWordKeys],
	);

	const handleToggleWord = useCallback((word: CaptionCueWord) => {
		const key = wordSelectionKey(word);
		setSelectedWordSpans((prev) => {
			const next = new Map(prev);
			if (next.has(key)) {
				next.delete(key);
			} else {
				next.set(key, { startMs: word.startMs, endMs: word.endMs });
			}
			return next;
		});
	}, []);

	const handleCutSelectedWords = useCallback(() => {
		if (activeSelectedSpans.length === 0 || !onCutTranscriptWords) {
			return;
		}
		const applied = onCutTranscriptWords(activeSelectedSpans);
		if (applied) {
			setSelectedWordSpans(new Map());
		}
	}, [activeSelectedSpans, onCutTranscriptWords]);

	if (!cue) {
		return null;
	}

	const canMerge = index < cues.length - 1;
	const selectedSeconds =
		Math.round(
			activeSelectedSpans.reduce(
				(sum, wordSpan) => sum + (wordSpan.endMs - wordSpan.startMs),
				0,
			) / 100,
		) / 10;

	return (
		<div className="flex flex-col gap-2">
			<button
				type="button"
				aria-pressed={cutMode}
				onClick={() => setCutMode((enabled) => !enabled)}
				className={
					cutMode
						? "flex h-9 items-center justify-center gap-1.5 rounded-lg border border-red-500/30 bg-red-500/15 text-xs font-medium text-red-400 transition-colors hover:bg-red-500/25"
						: "flex h-9 items-center justify-center gap-1.5 rounded-lg border border-foreground/10 bg-foreground/5 text-xs font-medium text-foreground transition-colors hover:bg-foreground/10"
				}
			>
				<Scissors className="h-4 w-4" />
				{t("captions.cutMode", "Cut mode")}
			</button>
			{cutMode ? (
				<TranscriptCutView
					key={cue.id}
					cue={cue}
					selectedWordSpans={selectedWordSpans}
					selectedWordCount={activeSelectedSpans.length}
					selectedSeconds={selectedSeconds}
					canCut={Boolean(onCutTranscriptWords)}
					onToggleWord={handleToggleWord}
					onCut={handleCutSelectedWords}
				/>
			) : (
				<CaptionEditor
					key={cue.id}
					cue={cue}
					canMerge={canMerge}
					currentTimeMs={currentTimeMs}
					onBeginEdit={onBeginCaptionEdit}
					onTextEdit={onCaptionTextEdit}
					onRetime={onCaptionRetime}
					onSplit={onCaptionSplit}
					onMerge={(id) => {
						if (canMerge) {
							onCaptionMerge(id, cues[index + 1].id);
						}
					}}
					onDelete={onCaptionDelete}
				/>
			)}
		</div>
	);
}
