import type { ReactElement } from "react";
import { useScopedT } from "@/contexts/I18nContext";
import {
	PROMPTER_BASE_SPEED_PX_PER_SEC,
	TELEPROMPTER_FONT_SIZE_OPTIONS,
	TELEPROMPTER_SPEED_OPTIONS,
} from "../prompterScroll";
import styles from "../LaunchWindow.module.css";
import { HudPopover } from "./PopoverScaffold";
import { useLaunchPopoverCoordinator } from "./LaunchPopoverCoordinator";

const POPOVER_ID = "notes";

function formatSpeedMultiplier(speedPxPerSec: number): string {
	const multiplier = speedPxPerSec / PROMPTER_BASE_SPEED_PX_PER_SEC;
	const rounded = Math.round(multiplier * 10) / 10;
	return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)}×`;
}

export function NotesPopover({
	trigger,
	notes,
	fontSize,
	scrollSpeed,
	onNotesChange,
	onFontSizeChange,
	onScrollSpeedChange,
}: {
	trigger: ReactElement;
	notes: string;
	fontSize: number;
	scrollSpeed: number;
	onNotesChange: (notes: string) => void;
	onFontSizeChange: (fontSize: number) => void;
	onScrollSpeedChange: (scrollSpeed: number) => void;
}) {
	const t = useScopedT("launch");
	const { isOpen, requestOpen, requestClose } = useLaunchPopoverCoordinator();
	const open = isOpen(POPOVER_ID);

	const pillClass = (selected: boolean) =>
		`${styles.notesPill} ${selected ? styles.notesPillSelected : ""}`;

	return (
		<HudPopover
			open={open}
			onOpenChange={(nextOpen) => {
				if (!nextOpen) {
					requestClose(POPOVER_ID);
					return;
				}
				requestOpen(POPOVER_ID);
			}}
			trigger={trigger}
			align="center"
		>
			<div className={styles.ddLabel}>{t("recording.notes")}</div>
			<textarea
				value={notes}
				onChange={(event) => onNotesChange(event.target.value)}
				placeholder={t("recording.notesPlaceholder")}
				rows={6}
				className={styles.notesTextarea}
				aria-label={t("recording.notes")}
			/>

			<div className={styles.ddLabel}>{t("recording.fontSize")}</div>
			<div className={styles.notesPillRow}>
				{TELEPROMPTER_FONT_SIZE_OPTIONS.map((size) => (
					<button
						key={size}
						type="button"
						className={pillClass(fontSize === size)}
						onClick={() => onFontSizeChange(size)}
						aria-pressed={fontSize === size}
					>
						{size}
					</button>
				))}
			</div>

			<div className={styles.ddLabel}>{t("recording.scrollSpeed")}</div>
			<div className={styles.notesPillRow}>
				{TELEPROMPTER_SPEED_OPTIONS.map((speed) => (
					<button
						key={speed}
						type="button"
						className={pillClass(scrollSpeed === speed)}
						onClick={() => onScrollSpeedChange(speed)}
						aria-pressed={scrollSpeed === speed}
					>
						{formatSpeedMultiplier(speed)}
					</button>
				))}
			</div>
		</HudPopover>
	);
}
